-- ─────────────────────────────────────────────────────────────────────────────
-- 083_bot_greeting.sql
--
-- Сценарий «Приветствие» — переезд из amoCRM Salesbot.
--
-- Бот работает 24/7 (без проверок времени суток):
--   1. Когда лид появляется в системе (через Green-API webhook ИЛИ когда
--      менеджер вручную перевёл сделку в первый этап) — bot_active=true.
--   2. /api/cron/bot-greeting раз в 5 мин шлёт приветственный шаблон.
--   3. Через 1 час, если клиент не ответил — /api/cron/bot-followup шлёт
--      напоминание и завершает работу бота. Если ответил — бот замолкает.
--   4. Бот также замолкает мгновенно, если менеджер написал в чат сделки
--      (см. POST /api/deals/[id]/messages) или сделка уехала в другой
--      этап (см. триггер trg_deals_stage_disable_bot ниже).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Поля состояния бота на сделке ────────────────────────────────────────────
-- Состояния (bot_state):
--   NULL              — бот ещё не начал работу (но bot_active=true → начнёт)
--   'greeted'         — приветствие отправлено, ждём ответ 1ч
--   'followup_sent'   — фоллоуап отправлен, бот завершён
--   'done'            — клиент ответил / менеджер взял сделку — бот завершён
--
-- bot_active=true означает «бот ещё может что-то прислать в этой сделке».
-- Финальные состояния всегда переводят bot_active=false, чтобы один и тот же
-- лид не повторно вошёл в очередь cron.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS bot_active            BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_state             TEXT,
  ADD COLUMN IF NOT EXISTS bot_greeting_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_followup_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_failure_count     INT         NOT NULL DEFAULT 0;

-- Частичный индекс — cron-запросы фильтруют только активные сделки. На фоне
-- 100k+ сделок без индекса полный seq scan каждые 5 мин был бы лишней нагрузкой.
CREATE INDEX IF NOT EXISTS idx_deals_bot_active
  ON deals (bot_active)
  WHERE bot_active = true;

-- ── Расширение deal_messages: метка отправителя «бот» ────────────────────────
-- В нашей схеме direction='out' раньше всегда означал «менеджер написал».
-- Бот тоже шлёт direction='out', но author_id остаётся NULL — этого мало,
-- чтобы UI отрисовал иконку 🤖 без лишних JOIN'ов. Заводим явное поле.
ALTER TABLE deal_messages
  ADD COLUMN IF NOT EXISTS sender_type TEXT;
-- Значения: NULL (по умолчанию) | 'bot'.
-- Не делаем ENUM, чтобы потом можно было расширять ('integration', 'system'…).

-- ── Ключи системных шаблонов ─────────────────────────────────────────────────
-- В исходной схеме message_templates идентифицируются по title + clinic_id, но
-- системные шаблоны (приветствие бота, фоллоуап) cron должен находить
-- детерминированно. Добавляем nullable key с уникальностью внутри клиники.
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_clinic_key
  ON message_templates (clinic_id, key)
  WHERE key IS NOT NULL;

-- ── Триггер: смена этапа выключает бота ──────────────────────────────────────
-- Канбан в /crm обновляет deals.stage_id напрямую через supabase-js (без
-- API-роута). Если делать выключение бота в коде каждой кнопки — забудем где-
-- нибудь. Триггер ловит ВСЕ источники: DnD, ручной выбор, bulk-операции,
-- импорт CSV.
CREATE OR REPLACE FUNCTION fn_deal_stage_disable_bot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Срабатываем только если этап реально поменялся И бот ещё активен.
  -- bot_state='done' нужен, чтобы UI мог отличить «бот никогда не запускался»
  -- от «бот был, но менеджер забрал сделку себе».
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id
     AND COALESCE(OLD.bot_active, false) = true THEN
    NEW.bot_active := false;
    NEW.bot_state  := 'done';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deals_stage_disable_bot ON deals;
CREATE TRIGGER trg_deals_stage_disable_bot
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_stage_disable_bot();
