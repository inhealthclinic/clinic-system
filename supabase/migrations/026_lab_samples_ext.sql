-- ============================================================
-- 026_lab_samples_ext.sql — clinic_id + audit triggers on lab_samples
-- Добавляет clinic_id (для RLS и аудита), индекс, backfill и аудит.
-- Идемпотентно.
-- ============================================================

-- 1) clinic_id column (nullable — чтобы не блокировать существующие строки)
ALTER TABLE lab_samples
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id);

-- Backfill из lab_orders (если есть строки без clinic_id)
UPDATE lab_samples ls
   SET clinic_id = lo.clinic_id
  FROM lab_orders lo
 WHERE ls.clinic_id IS NULL AND ls.lab_order_id = lo.id;

CREATE INDEX IF NOT EXISTS idx_lab_samples_clinic
  ON lab_samples(clinic_id);

-- 2) Audit trigger (severity=high для lab_samples — это клинические события)
DROP TRIGGER IF EXISTS trg_audit_lab_samples ON lab_samples;
CREATE TRIGGER trg_audit_lab_samples
AFTER INSERT OR UPDATE OR DELETE ON lab_samples
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- 3) RLS: ограничить видимость по клинике (без этого лаборанты других клиник
--    могли бы видеть образцы). Policy перезаписываем на clinic-scoped.
DROP POLICY IF EXISTS "Auth manage lab_samples" ON lab_samples;

CREATE POLICY "lab_samples_clinic_scope"
  ON lab_samples FOR ALL
  TO authenticated
  USING (
    clinic_id IS NULL  -- для старых строк до миграции
    OR clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    clinic_id IS NULL
    OR clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
