-- ─────────────────────────────────────────────────────────────────────────────
-- 085_pipeline_automation.sql
--
-- Полная автоматизация воронки «Лиды» — переезд из amoCRM Salesbot.
--
-- Шесть автоматизаций:
--   A. Неразобранное → приветствие бота           (см. 083: bot_greeting/followup)
--   B. В работе  + 24ч без ответа → задача 24h
--   C. В работе  + 48ч без ответа → задача 48h
--   D. Касание   → 1-е касание (сразу при входе)
--   E. Касание   + 120ч после 1-го → 2-е касание
--   F. Касание   + 240ч после 1-го (= +120ч после 2-го) → 3-е касание
--   G. Без ответа после 3-го касания (>+24ч) → задача
--
-- 083 уже добавил bot_active/bot_state/bot_*_sent_at/bot_failure_count и
-- триггер fn_deal_stage_disable_bot. Здесь — только новые поля для блоков B–G.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Поля для блоков «Касание» ────────────────────────────────────────────────
-- entered_touch_stage_at — когда сделка вошла в этап Касание (cron сравнивает
-- с now() для расчёта 1/120/240ч). Нужно отдельно от stage_entered_at —
-- последний обнуляется при ЛЮБОЙ смене этапа, нам же критично пережить
-- движения «Касание ↔ В работе ↔ обратно».
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS touch1_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS touch2_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS touch3_sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entered_touch_stage_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entered_work_stage_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_24h_created_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_48h_created_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_no_reply_created_at TIMESTAMPTZ,
  -- Кэш последнего входящего сообщения — чтобы cron «без ответа за N часов»
  -- не делал N запросов в deal_messages. Поддерживается триггером ниже.
  ADD COLUMN IF NOT EXISTS last_inbound_message_at TIMESTAMPTZ;

-- Частичные индексы для быстрых cron-выборок: только активные сделки в нужных
-- стадиях. На фоне закрытых сделок это резко срезает scan.
CREATE INDEX IF NOT EXISTS idx_deals_touch_stage
  ON deals (entered_touch_stage_at)
  WHERE entered_touch_stage_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_work_stage
  ON deals (entered_work_stage_at)
  WHERE entered_work_stage_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_last_inbound
  ON deals (last_inbound_message_at)
  WHERE last_inbound_message_at IS NOT NULL;

-- ── Триггер: ловим вход в «Касание» / «В работе» ─────────────────────────────
-- record_deal_stage_change уже стоит на BEFORE UPDATE deals и обнуляет
-- stage_entered_at. Делаем отдельный триггер, который ставит наши маркеры
-- именно при входе в нужный этап. Сбрасываем их же при выходе из этапа,
-- чтобы счётчики 120/240ч не «оживали» после возврата.
CREATE OR REPLACE FUNCTION fn_deal_stage_automation_marks()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new_code TEXT;
  v_old_code TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT code INTO v_new_code FROM pipeline_stages WHERE id = NEW.stage_id;
    SELECT code INTO v_old_code FROM pipeline_stages WHERE id = OLD.stage_id;

    IF v_new_code = 'contact' THEN
      -- Вход в Касание — обнуляем все маркеры касаний и задач, ставим вход.
      NEW.entered_touch_stage_at := now();
      NEW.touch1_sent_at  := NULL;
      NEW.touch2_sent_at  := NULL;
      NEW.touch3_sent_at  := NULL;
      NEW.task_no_reply_created_at := NULL;
    ELSIF v_old_code = 'contact' AND v_new_code IS DISTINCT FROM 'contact' THEN
      -- Уехали из Касания — гасим маркер, чтобы cron не дотянул 2/3 касание.
      NEW.entered_touch_stage_at := NULL;
    END IF;

    IF v_new_code = 'in_progress' THEN
      NEW.entered_work_stage_at := now();
      NEW.task_24h_created_at   := NULL;
      NEW.task_48h_created_at   := NULL;
    ELSIF v_old_code = 'in_progress' AND v_new_code IS DISTINCT FROM 'in_progress' THEN
      NEW.entered_work_stage_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deals_stage_automation_marks ON deals;
CREATE TRIGGER trg_deals_stage_automation_marks
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_stage_automation_marks();

-- ── Триггер: кэшируем last_inbound_message_at на сделке ──────────────────────
-- Cron-эндпоинты «не ответил за N часов» иначе будут джойнить deal_messages
-- по каждой сделке. Денормализация: при INSERT входящего пишем в deals.
CREATE OR REPLACE FUNCTION fn_deal_messages_update_last_inbound()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction = 'in' THEN
    UPDATE deals
       SET last_inbound_message_at = GREATEST(
             COALESCE(last_inbound_message_at, NEW.created_at),
             NEW.created_at)
     WHERE id = NEW.deal_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deal_messages_update_last_inbound ON deal_messages;
CREATE TRIGGER trg_deal_messages_update_last_inbound
  AFTER INSERT ON deal_messages
  FOR EACH ROW EXECUTE FUNCTION fn_deal_messages_update_last_inbound();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- 1. last_inbound_message_at — для существующих сделок.
UPDATE deals d
   SET last_inbound_message_at = sub.last_in
  FROM (
    SELECT deal_id, MAX(created_at) AS last_in
      FROM deal_messages
     WHERE direction = 'in'
     GROUP BY deal_id
  ) sub
 WHERE sub.deal_id = d.id
   AND d.last_inbound_message_at IS NULL;

-- 2. entered_touch_stage_at / entered_work_stage_at — для уже стоящих в этапе.
--    Берём stage_entered_at: для «висящих» в стадии оно валидно.
UPDATE deals d
   SET entered_touch_stage_at = d.stage_entered_at
  FROM pipeline_stages s
 WHERE d.stage_id = s.id
   AND s.code = 'contact'
   AND d.entered_touch_stage_at IS NULL
   AND d.deleted_at IS NULL;

UPDATE deals d
   SET entered_work_stage_at = d.stage_entered_at
  FROM pipeline_stages s
 WHERE d.stage_id = s.id
   AND s.code = 'in_progress'
   AND d.entered_work_stage_at IS NULL
   AND d.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
