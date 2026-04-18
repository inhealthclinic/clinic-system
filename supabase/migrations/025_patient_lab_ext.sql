-- ============================================================
-- 025_patient_lab_ext.sql — расширенные лаб. нюансы пациента
-- fasting_status / cycle_day / taking_medications / medications_note
-- Идемпотентно.
-- ============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS fasting_status      TEXT
    CHECK (fasting_status IS NULL OR fasting_status IN ('yes','no','unknown')),
  ADD COLUMN IF NOT EXISTS taking_medications  TEXT
    CHECK (taking_medications IS NULL OR taking_medications IN ('yes','no','unknown')),
  ADD COLUMN IF NOT EXISTS medications_note    TEXT,
  ADD COLUMN IF NOT EXISTS cycle_day           INT
    CHECK (cycle_day IS NULL OR (cycle_day >= 1 AND cycle_day <= 60));

-- Расширяем menopause_status: добавляем 'unknown' как валидное значение.
-- Старый CHECK допускал только ('no','peri','post'); теперь ('no','peri','post','unknown').
DO $menopause$
BEGIN
  BEGIN
    ALTER TABLE patients DROP CONSTRAINT patients_menopause_status_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  ALTER TABLE patients
    ADD CONSTRAINT patients_menopause_status_check
    CHECK (menopause_status IS NULL OR menopause_status IN ('no','peri','post','unknown'));
END
$menopause$;

NOTIFY pgrst, 'reload schema';
