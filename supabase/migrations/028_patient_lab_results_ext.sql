-- ============================================================
-- 028_patient_lab_results_ext.sql — бэкфилл, RLS, аудит
-- Наполняет плоскую историю из уже верифицированных заказов,
-- ограничивает доступ по клинике, подключает аудит.
-- Идемпотентно.
-- ============================================================

-- 1) Backfill: если где-то триггер не сработал или данные были
--    до его установки — подтянуть все верифицированные заказы.
INSERT INTO patient_lab_results (
  clinic_id, patient_id, service_id, service_name_snapshot,
  result_value, result_text, unit_snapshot,
  reference_min, reference_max, reference_text,
  flag, lab_order_id, lab_order_item_id, visit_id, result_date
)
SELECT
  lo.clinic_id,
  lo.patient_id,
  i.service_id,
  i.name,
  i.result_value,
  i.result_text,
  i.unit_snapshot,
  i.reference_min,
  i.reference_max,
  i.reference_text,
  i.flag,
  lo.id,
  i.id,
  lo.visit_id,
  COALESCE(i.completed_at, lo.ordered_at, now())
FROM lab_orders lo
JOIN lab_order_items i ON i.order_id = lo.id
WHERE lo.status IN ('verified','delivered')
  AND lo.clinic_id IS NOT NULL
  AND (i.result_value IS NOT NULL OR i.result_text IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM patient_lab_results p
    WHERE p.lab_order_item_id = i.id
  );

-- 2) Clinic-scoped RLS (заменяет открытую "Auth manage patient_lab_results")
DROP POLICY IF EXISTS "Auth manage patient_lab_results" ON patient_lab_results;

CREATE POLICY "patient_lab_results_clinic_scope"
  ON patient_lab_results FOR ALL
  TO authenticated
  USING (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  );

-- 3) Audit trigger — изменения истории анализов клинически важны
DROP TRIGGER IF EXISTS trg_audit_patient_lab_results ON patient_lab_results;
CREATE TRIGGER trg_audit_patient_lab_results
AFTER INSERT OR UPDATE OR DELETE ON patient_lab_results
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

NOTIFY pgrst, 'reload schema';
