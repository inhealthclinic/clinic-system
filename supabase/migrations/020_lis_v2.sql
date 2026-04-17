-- ============================================================
-- 020_lis_v2.sql
-- LIS (Laboratory Information System) v2
--
-- Расширяет существующую лабораторию по спецификации:
--   • services: result_type / default_unit / reference_min / reference_max / reference_text
--   • lab_order_items: прямой ввод результата (snapshot единиц / референсов / флаг)
--   • lab_samples: учёт биоматериала
--   • patient_lab_results: плоская история анализов пациента (ключевое)
--   • reference_ranges: структурированные референсы (пол/возраст)
--   • trigger: при verified — копируем результаты в patient_lab_results
--
-- Идемпотентно. Ничего не ломает — существующие UI продолжают работать.
-- ============================================================

-- ── 1) services: тип результата и референсы напрямую ─────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS result_type     TEXT
    CHECK (result_type IN ('numeric','text','qualitative')),
  ADD COLUMN IF NOT EXISTS default_unit    TEXT,
  ADD COLUMN IF NOT EXISTS reference_min   DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_max   DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_text  TEXT,
  ADD COLUMN IF NOT EXISTS search_keywords JSONB NOT NULL DEFAULT '[]';

-- Для лаб. услуг без типа результата — дефолт numeric
UPDATE services SET result_type = 'numeric'
  WHERE is_lab = true AND result_type IS NULL;

-- ── 2) lab_order_items: результат прямо в позиции ────────────
-- Если колонки добавлены ad-hoc ранее — не трогаем (IF NOT EXISTS)
ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS service_id            UUID REFERENCES services(id),
  ADD COLUMN IF NOT EXISTS result_value          DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS result_text           TEXT,
  ADD COLUMN IF NOT EXISTS unit_snapshot         TEXT,
  ADD COLUMN IF NOT EXISTS reference_min         DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_max         DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS reference_text        TEXT,
  ADD COLUMN IF NOT EXISTS flag                  TEXT
    CHECK (flag IS NULL OR flag IN ('normal','low','high','critical')),
  ADD COLUMN IF NOT EXISTS completed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by          UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS comment               TEXT;

-- Расширяем CHECK на новые статусы (сохраняем совместимость).
-- В 008 было только pending/completed — сносим старый чек (если есть) и ставим новый.
ALTER TABLE lab_order_items DROP CONSTRAINT IF EXISTS lab_order_items_status_check;

ALTER TABLE lab_order_items
  ADD CONSTRAINT lab_order_items_status_check
  CHECK (status IN ('pending','collected','in_progress','done','verified','completed'));

-- ── 3) lab_samples: учёт биоматериала ────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_lab_samples_order
  ON lab_samples(lab_order_id);

-- ── 4) reference_ranges: структурированные референсы ─────────
CREATE TABLE IF NOT EXISTS reference_ranges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sex        TEXT CHECK (sex IS NULL OR sex IN ('M','F')),
  age_min    INT,          -- лет, NULL = без ограничения снизу
  age_max    INT,          -- лет, NULL = без ограничения сверху
  min_value  DECIMAL(12,4),
  max_value  DECIMAL(12,4),
  text       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_ranges_service
  ON reference_ranges(service_id);

-- ── 5) patient_lab_results: плоская история (ключевое) ───────
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

CREATE INDEX IF NOT EXISTS idx_patient_lab_results_patient
  ON patient_lab_results(patient_id, result_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_lab_results_service
  ON patient_lab_results(patient_id, service_id, result_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_lab_results_clinic
  ON patient_lab_results(clinic_id);

-- ── 6) RLS ───────────────────────────────────────────────────
ALTER TABLE lab_samples          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_ranges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_lab_results  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth manage lab_samples"         ON lab_samples;
DROP POLICY IF EXISTS "Auth manage reference_ranges"    ON reference_ranges;
DROP POLICY IF EXISTS "Auth manage patient_lab_results" ON patient_lab_results;

CREATE POLICY "Auth manage lab_samples"
  ON lab_samples FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage reference_ranges"
  ON reference_ranges FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage patient_lab_results"
  ON patient_lab_results FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 7) Триггер: при verified — копируем в patient_lab_results ─
-- При переходе lab_orders.status -> 'verified' раскладываем
-- все items в плоскую историю пациента.

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

-- ── 8) Авто-флаг в lab_order_items при установке result_value ─
CREATE OR REPLACE FUNCTION auto_flag_lab_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.result_value IS NOT NULL THEN
    IF NEW.reference_min IS NOT NULL AND NEW.result_value < NEW.reference_min THEN
      NEW.flag := 'low';
    ELSIF NEW.reference_max IS NOT NULL AND NEW.result_value > NEW.reference_max THEN
      NEW.flag := 'high';
    ELSIF (NEW.reference_min IS NOT NULL OR NEW.reference_max IS NOT NULL) THEN
      NEW.flag := 'normal';
    END IF;

    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_auto_flag_lab_item ON lab_order_items;
CREATE TRIGGER trg_auto_flag_lab_item
  BEFORE INSERT OR UPDATE OF result_value, reference_min, reference_max
  ON lab_order_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_flag_lab_item();
