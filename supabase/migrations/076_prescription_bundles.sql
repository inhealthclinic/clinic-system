-- ============================================================
-- 076_prescription_bundles.sql
-- Комбинированные шаблоны назначений врача:
-- одна «кнопка» = несколько препаратов.
-- Пример: «Гипертония I ст.» → 3 препарата.
-- ============================================================

CREATE TABLE IF NOT EXISTS prescription_bundles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id     UUID REFERENCES doctors(id) ON DELETE CASCADE,
  -- если doctor_id NULL → общеклинический шаблон (виден всем врачам клиники)
  name          TEXT NOT NULL,
  icd10_hint    TEXT,                 -- подсказка: «I10», «J06.9» и т.п.
  prescriptions JSONB NOT NULL DEFAULT '[]',
  -- [{drug_name, dosage, frequency, duration}]
  use_count     INT  NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pres_bundles_doctor
  ON prescription_bundles(doctor_id, use_count DESC)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_pres_bundles_clinic
  ON prescription_bundles(clinic_id, use_count DESC)
  WHERE is_active;

ALTER TABLE prescription_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pres_bundles: own clinic" ON prescription_bundles;
CREATE POLICY "pres_bundles: own clinic"
  ON prescription_bundles
  FOR ALL
  USING (clinic_id = current_clinic_id());
