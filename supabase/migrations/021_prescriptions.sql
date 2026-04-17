-- ============================================================
-- 021_prescriptions.sql — Рецепты и назначения
-- Структурированные назначения (препарат/дозировка/курс) + печать.
-- Идемпотентно.
-- ============================================================

CREATE TABLE IF NOT EXISTS prescriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id)     ON DELETE CASCADE,
  patient_id    UUID NOT NULL REFERENCES patients(id)    ON DELETE CASCADE,
  visit_id      UUID          REFERENCES visits(id)      ON DELETE SET NULL,
  doctor_id     UUID          REFERENCES doctors(id)     ON DELETE SET NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  diagnosis     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES user_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_visit   ON prescriptions(visit_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic  ON prescriptions(clinic_id);

CREATE TABLE IF NOT EXISTS prescription_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id  UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  form             TEXT,       -- таблетки, раствор, мазь и т.п.
  dosage           TEXT,       -- 500 мг / 1 капля и т.п.
  frequency        TEXT,       -- 2 раза в день
  duration         TEXT,       -- 7 дней
  route            TEXT,       -- внутрь / наружно / в/м
  instructions     TEXT,       -- свободный текст (до/после еды, запивать и т.п.)
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_rx ON prescription_items(prescription_id, sort_order);

-- RLS
ALTER TABLE prescriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth manage prescriptions"      ON prescriptions;
DROP POLICY IF EXISTS "Auth manage prescription_items" ON prescription_items;

CREATE POLICY "Auth manage prescriptions"
  ON prescriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage prescription_items"
  ON prescription_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
