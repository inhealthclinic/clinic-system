-- ============================================================
-- 029_inventory_writeoff_audit.sql — ручное списание + аудит
-- Расширяет CHECK на inventory_movements, добавляет notes/performed_by,
-- вешает audit_trigger на инвентарные таблицы.
-- Идемпотентно.
-- ============================================================

-- 1) Гарантируем нужные колонки на inventory_movements (для ручного списания)
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS notes        TEXT,
  ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES user_profiles(id);

-- 2) Пересобираем CHECK на типы движений, чтобы разрешить
--    как старые (incoming, writeoff_service, writeoff_lab, damaged, expired, correction, return),
--    так и «упрощённые» из UI (receipt, consumption, writeoff).
DO $mov$
BEGIN
  BEGIN
    ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_type_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movements_type_check
    CHECK (type IN (
      -- old vocabulary
      'incoming','writeoff_service','writeoff_lab',
      'damaged','expired','correction','return',
      -- new vocabulary from UI
      'receipt','consumption','writeoff'
    ));
END
$mov$;

-- 3) Audit triggers — инвентарь критичен (ручные списания, цены)
DROP TRIGGER IF EXISTS trg_audit_inventory_batches ON inventory_batches;
CREATE TRIGGER trg_audit_inventory_batches
AFTER INSERT OR UPDATE OR DELETE ON inventory_batches
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_inventory_movements ON inventory_movements;
CREATE TRIGGER trg_audit_inventory_movements
AFTER INSERT OR UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_reagents ON reagents;
CREATE TRIGGER trg_audit_reagents
AFTER INSERT OR UPDATE OR DELETE ON reagents
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_consumables ON consumables;
CREATE TRIGGER trg_audit_consumables
AFTER INSERT OR UPDATE OR DELETE ON consumables
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

NOTIFY pgrst, 'reload schema';
