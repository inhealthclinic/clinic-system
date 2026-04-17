-- ============================================================
-- 020b_lis_trigger_finalize.sql — ЧАСТЬ 2/3
-- Триггер: при переходе lab_orders.status → 'verified'
-- копирует все items в patient_lab_results (плоская история).
-- Запускать ТОЛЬКО после 020a.
-- ============================================================

CREATE OR REPLACE FUNCTION finalize_lab_order_to_history()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.status = 'verified' AND (OLD.status IS DISTINCT FROM 'verified') THEN
    INSERT INTO patient_lab_results (
      clinic_id, patient_id, service_id, service_name_snapshot,
      result_value, result_text, unit_snapshot,
      reference_min, reference_max, reference_text,
      flag, lab_order_id, lab_order_item_id, visit_id, result_date
    )
    SELECT
      NEW.clinic_id,
      NEW.patient_id,
      i.service_id,
      i.name,
      i.result_value,
      i.result_text,
      i.unit_snapshot,
      i.reference_min,
      i.reference_max,
      i.reference_text,
      i.flag,
      NEW.id,
      i.id,
      NEW.visit_id,
      COALESCE(i.completed_at, now())
    FROM lab_order_items i
    WHERE i.order_id = NEW.id
      AND (i.result_value IS NOT NULL OR i.result_text IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM patient_lab_results p
        WHERE p.lab_order_item_id = i.id
      );
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_finalize_lab_order ON lab_orders;
CREATE TRIGGER trg_finalize_lab_order
  AFTER UPDATE OF status ON lab_orders
  FOR EACH ROW
  EXECUTE FUNCTION finalize_lab_order_to_history();
