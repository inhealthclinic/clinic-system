-- ============================================================
-- 092_trigger_executions_dedup_key.sql
--
-- Расширяем pipeline_trigger_executions для recurring-триггеров:
--   • daily_at        — должен срабатывать каждый день
--   • no_reply_hours  — должен сработать после нового inbound (если снова молчат)
--
-- Старая модель: UNIQUE (trigger_id, deal_id) — пускает действие один раз
-- за вход в стадию, что годится только для immediate/delay (on_enter).
--
-- Новая модель: добавляем `dedup_key TEXT`. Когда NULL — поведение прежнее
-- (immediate/delay). Когда задан — уникальность по тройке. Это позволяет:
--   • daily_at:       dedup_key = 'YYYY-MM-DD' (одно срабатывание в сутки)
--   • no_reply_hours: dedup_key = '<last_inbound_message_id>' (один раз
--                     для конкретного «затишья», возобновляется при
--                     следующем inbound)
-- ============================================================

ALTER TABLE pipeline_trigger_executions
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Снимаем старое UNIQUE (если ещё на месте под именем по умолчанию)
ALTER TABLE pipeline_trigger_executions
  DROP CONSTRAINT IF EXISTS pipeline_trigger_executions_trigger_id_deal_id_key;

-- Партициальные уникальные индексы:
-- 1) NULL dedup_key — однократное исполнение per (trigger, deal)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pte_one_shot
  ON pipeline_trigger_executions(trigger_id, deal_id)
  WHERE dedup_key IS NULL;

-- 2) ненулевой dedup_key — уникально per (trigger, deal, key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pte_keyed
  ON pipeline_trigger_executions(trigger_id, deal_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
