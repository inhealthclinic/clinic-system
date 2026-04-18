-- ============================================================
-- 023_patient_lab_fields.sql — лабораторно-релевантные поля пациента
-- pregnancy_status / pregnancy_weeks / menopause_status / lab_notes
-- Идемпотентно.
-- ============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS pregnancy_status TEXT
    CHECK (pregnancy_status IN ('yes','no','unknown')) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS pregnancy_weeks  INT
    CHECK (pregnancy_weeks IS NULL OR (pregnancy_weeks >= 1 AND pregnancy_weeks <= 42)),
  ADD COLUMN IF NOT EXISTS menopause_status TEXT
    CHECK (menopause_status IS NULL OR menopause_status IN ('no','peri','post')),
  ADD COLUMN IF NOT EXISTS lab_notes        TEXT;
