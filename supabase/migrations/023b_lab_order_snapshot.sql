-- ============================================================
-- 023b_lab_order_snapshot.sql — snapshot пациента в lab_orders
-- Замораживает демографические данные на момент создания заказа.
-- Идемпотентно.
-- ============================================================

ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS patient_name_snapshot    TEXT,
  ADD COLUMN IF NOT EXISTS sex_snapshot             TEXT
    CHECK (sex_snapshot IS NULL OR sex_snapshot IN ('male','female','other')),
  ADD COLUMN IF NOT EXISTS age_snapshot             INT,
  ADD COLUMN IF NOT EXISTS pregnancy_snapshot       TEXT
    CHECK (pregnancy_snapshot IS NULL OR pregnancy_snapshot IN ('yes','no','unknown')),
  ADD COLUMN IF NOT EXISTS pregnancy_weeks_snapshot INT,
  ADD COLUMN IF NOT EXISTS lab_notes_snapshot       TEXT;

-- Для старых заказов (если есть) — заполнить из пациента один раз
UPDATE lab_orders lo
SET
  patient_name_snapshot = COALESCE(lo.patient_name_snapshot, p.full_name),
  sex_snapshot          = COALESCE(lo.sex_snapshot, p.gender),
  age_snapshot          = COALESCE(
                            lo.age_snapshot,
                            CASE WHEN p.birth_date IS NOT NULL
                                 THEN EXTRACT(YEAR FROM age(p.birth_date))::INT
                                 ELSE NULL END
                          )
FROM patients p
WHERE lo.patient_id = p.id
  AND (lo.patient_name_snapshot IS NULL OR lo.sex_snapshot IS NULL OR lo.age_snapshot IS NULL);
