-- ============================================================
-- 025b_lab_order_snapshot_ext.sql — snapshot расширенных нюансов
-- Замораживает fasting / cycle_day / taking_medications в заказе.
-- Идемпотентно.
-- ============================================================

ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS fasting_snapshot            TEXT
    CHECK (fasting_snapshot IS NULL OR fasting_snapshot IN ('yes','no','unknown')),
  ADD COLUMN IF NOT EXISTS taking_medications_snapshot TEXT
    CHECK (taking_medications_snapshot IS NULL OR taking_medications_snapshot IN ('yes','no','unknown')),
  ADD COLUMN IF NOT EXISTS medications_note_snapshot   TEXT,
  ADD COLUMN IF NOT EXISTS cycle_day_snapshot          INT
    CHECK (cycle_day_snapshot IS NULL OR (cycle_day_snapshot >= 1 AND cycle_day_snapshot <= 60)),
  ADD COLUMN IF NOT EXISTS menopause_snapshot          TEXT
    CHECK (menopause_snapshot IS NULL OR menopause_snapshot IN ('no','peri','post','unknown'));

-- Backfill из patients (один раз для существующих заказов)
UPDATE lab_orders lo
SET
  fasting_snapshot            = COALESCE(lo.fasting_snapshot, p.fasting_status),
  taking_medications_snapshot = COALESCE(lo.taking_medications_snapshot, p.taking_medications),
  medications_note_snapshot   = COALESCE(lo.medications_note_snapshot, p.medications_note),
  cycle_day_snapshot          = COALESCE(lo.cycle_day_snapshot, p.cycle_day),
  menopause_snapshot          = COALESCE(lo.menopause_snapshot, p.menopause_status)
FROM patients p
WHERE lo.patient_id = p.id
  AND (
    lo.fasting_snapshot IS NULL OR
    lo.taking_medications_snapshot IS NULL OR
    lo.medications_note_snapshot IS NULL OR
    lo.cycle_day_snapshot IS NULL OR
    lo.menopause_snapshot IS NULL
  );

NOTIFY pgrst, 'reload schema';
