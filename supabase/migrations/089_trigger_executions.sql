-- ============================================================
-- 089_trigger_executions.sql
--
-- Журнал исполнений пользовательских триггеров (мигр. 088).
-- Нужен для идемпотентности cron: при перезапуске не выполняем
-- триггер на той же сделке дважды.
--
-- Уникальный индекс (trigger_id, deal_id) — для триггеров с event='on_enter':
-- одна сделка получает действие один раз за вход в стадию. При повторном
-- входе (deals.entered_touch_stage_at сбрасывается в 085) — нужно очищать,
-- но проще: при on_exit в DB-триггере удаляем executions для этой сделки
-- по триггерам этой стадии. Реализуется в коде, не в БД.
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_trigger_executions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  trigger_id   UUID NOT NULL REFERENCES pipeline_stage_triggers(id) ON DELETE CASCADE,
  deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','skipped')),
  error        TEXT,
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trigger_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_pte_deal     ON pipeline_trigger_executions(deal_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pte_trigger  ON pipeline_trigger_executions(trigger_id, executed_at DESC);

ALTER TABLE pipeline_trigger_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pte_clinic ON pipeline_trigger_executions;
CREATE POLICY pte_clinic ON pipeline_trigger_executions
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- ── Сброс executions при выходе сделки из стадии ────────────
-- Чтобы при повторном входе в ту же стадию триггеры отработали снова.
CREATE OR REPLACE FUNCTION fn_deal_clear_trigger_executions_on_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id AND OLD.stage_id IS NOT NULL THEN
    DELETE FROM pipeline_trigger_executions e
     USING pipeline_stage_triggers t
     WHERE e.deal_id = NEW.id
       AND e.trigger_id = t.id
       AND t.stage_id = OLD.stage_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deal_clear_trigger_executions ON deals;
CREATE TRIGGER trg_deal_clear_trigger_executions
  AFTER UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_clear_trigger_executions_on_stage_change();

NOTIFY pgrst, 'reload schema';
