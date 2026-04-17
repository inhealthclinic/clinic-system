-- ============================================================
-- 020a_lis_schema.sql — ЧАСТЬ 1/3: только DDL (колонки, таблицы, RLS).
-- Никаких функций и триггеров. Безопасно для Supabase SQL Editor.
-- ============================================================

-- 1) services
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS result_type     TEXT
    CHECK (result_type IN ('numeric','text','qualitative')),
  ADD COLUMN IF NOT EXISTS default_unit    TEXT,
  ADD COLUMN IF NOT EXISTS reference_min   DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_max   DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_text  TEXT,
  ADD COLUMN IF NOT EXISTS search_keywords JSONB NOT NULL DEFAULT '[]';

UPDATE services SET result_type = 'numeric'
  WHERE is_lab = true AND result_type IS NULL;

-- 2) lab_order_items — новые колонки
ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS service_id     UUID REFERENCES services(id),
  ADD COLUMN IF NOT EXISTS result_value   DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS result_text    TEXT,
  ADD COLUMN IF NOT EXISTS unit_snapshot  TEXT,
  ADD COLUMN IF NOT EXISTS reference_min  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_max  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_text TEXT,
  ADD COLUMN IF NOT EXISTS flag           TEXT
    CHECK (flag IS NULL OR flag IN ('normal','low','high','critical')),
  ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by   UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS comment        TEXT;

-- Расширяем CHECK status
ALTER TABLE lab_order_items DROP CONSTRAINT IF EXISTS lab_order_items_status_check;
ALTER TABLE lab_order_items
  ADD CONSTRAINT lab_order_items_status_check
  CHECK (status IN ('pending','collected','in_progress','done','verified','completed'));

-- 3) lab_samples
CREATE TABLE IF NOT EXISTS lab_samples (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id  UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  sample_type   TEXT NOT NULL DEFAULT 'blood'
                  CHECK (sample_type IN ('blood','urine','stool','smear','saliva','other')),
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_by  UUID REFERENCES user_profiles(id),
  status        TEXT NOT NULL DEFAULT 'collected'
                  CHECK (status IN ('pending','collected','rejected')),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_samples_order ON lab_samples(lab_order_id);

-- 4) reference_ranges
CREATE TABLE IF NOT EXISTS reference_ranges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sex        TEXT CHECK (sex IS NULL OR sex IN ('M','F')),
  age_min    INT,
  age_max    INT,
  min_value  DECIMAL(12,4),
  max_value  DECIMAL(12,4),
  text       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reference_ranges_service ON reference_ranges(service_id);

-- 5) patient_lab_results — плоская история
CREATE TABLE IF NOT EXISTS patient_lab_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  service_id            UUID REFERENCES services(id),
  service_name_snapshot TEXT NOT NULL,
  result_value          DECIMAL(12,4),
  result_text           TEXT,
  unit_snapshot         TEXT,
  reference_min         DECIMAL(12,4),
  reference_max         DECIMAL(12,4),
  reference_text        TEXT,
  flag                  TEXT CHECK (flag IS NULL OR flag IN ('normal','low','high','critical')),
  lab_order_id          UUID REFERENCES lab_orders(id) ON DELETE SET NULL,
  lab_order_item_id     UUID REFERENCES lab_order_items(id) ON DELETE SET NULL,
  visit_id              UUID REFERENCES visits(id) ON DELETE SET NULL,
  result_date           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_lab_results_patient ON patient_lab_results(patient_id, result_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_lab_results_service ON patient_lab_results(patient_id, service_id, result_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_lab_results_clinic  ON patient_lab_results(clinic_id);

-- 6) RLS
ALTER TABLE lab_samples          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_ranges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_results  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth manage lab_samples"         ON lab_samples;
DROP POLICY IF EXISTS "Auth manage reference_ranges"    ON reference_ranges;
DROP POLICY IF EXISTS "Auth manage patient_lab_results" ON patient_lab_results;

CREATE POLICY "Auth manage lab_samples"
  ON lab_samples FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage reference_ranges"
  ON reference_ranges FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage patient_lab_results"
  ON patient_lab_results FOR ALL TO authenticated USING (true) WITH CHECK (true);
