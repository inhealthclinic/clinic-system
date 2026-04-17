-- ============================================================
-- 008_lab.sql
-- Лаборатория: категории, шаблоны, панели, заказы, результаты
-- ============================================================

CREATE TABLE lab_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT
);

-- ============================================================
-- LAB TEST TEMPLATES (шаблоны анализов с референсами)
-- ============================================================
CREATE TABLE lab_test_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  category_id  UUID REFERENCES lab_categories(id),
  name         TEXT NOT NULL,
  code         TEXT,
  turnaround_h INT NOT NULL DEFAULT 24,
  price        DECIMAL(10,2),
  parameters   JSONB NOT NULL DEFAULT '[]',
  -- [{
  --   name, unit,
  --   ref_min, ref_max,
  --   ref_gender: {male:{min,max}, female:{min,max}},
  --   ref_age: [{age_from,age_to,min,max}],
  --   ref_pregnancy: {min,max},
  --   method,
  --   critical_low, critical_high
  -- }]
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LAB PANELS (наборы: anemia, thyroid, checkup...)
-- ============================================================
CREATE TABLE lab_panels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  name         TEXT NOT NULL,
  slug         TEXT CHECK (slug IN ('anemia','thyroid','checkup','metabolic','female_health','custom')),
  template_ids UUID[] NOT NULL,
  price        DECIMAL(10,2),
  is_active    BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================
-- LAB ORDERS (направления на анализы)
-- ============================================================
CREATE SEQUENCE lab_order_number_seq START 1000;

CREATE TABLE lab_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  patient_id       UUID NOT NULL REFERENCES patients(id),
  visit_id         UUID REFERENCES visits(id),
  doctor_id        UUID REFERENCES doctors(id),
  order_number     TEXT UNIQUE,
  status           TEXT NOT NULL DEFAULT 'ordered'
                     CHECK (status IN (
                       'ordered','agreed','paid','sample_taken',
                       'in_progress','rejected','ready','verified','delivered'
                     )),
  urgent           BOOLEAN NOT NULL DEFAULT false,
  -- Внешняя лаборатория
  external_lab_name    TEXT,
  sent_to_external_at  TIMESTAMPTZ,
  sent_by              UUID REFERENCES user_profiles(id),
  expected_ready_at    TIMESTAMPTZ,
  received_at          TIMESTAMPTZ,
  received_by          UUID REFERENCES user_profiles(id),
  -- Отклонение образца
  rejected_reason      TEXT CHECK (rejected_reason IN (
    'hemolysis','insufficient_volume','wrong_tube','contaminated','expired','other'
  )),
  rejected_at          TIMESTAMPTZ,
  rejected_by          UUID REFERENCES user_profiles(id),
  resample_order_id    UUID REFERENCES lab_orders(id),
  -- Верификация
  verified_at          TIMESTAMPTZ,
  verified_by          UUID REFERENCES user_profiles(id),
  -- Мета
  notes                TEXT,
  ordered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_taken_at      TIMESTAMPTZ,
  created_by           UUID REFERENCES user_profiles(id)
);

-- Автономер заказа
CREATE OR REPLACE FUNCTION auto_lab_order_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.order_number := 'LAB-' || TO_CHAR(now(), 'YYYY') || '-' ||
    LPAD(nextval('lab_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_lab_order_number
  BEFORE INSERT ON lab_orders
  FOR EACH ROW WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION auto_lab_order_number();

-- ============================================================
-- LAB ORDER ITEMS (позиции в направлении)
-- ============================================================
CREATE TABLE lab_order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  template_id UUID REFERENCES lab_test_templates(id),
  name        TEXT NOT NULL,
  price       DECIMAL(10,2),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','completed'))
);

-- ============================================================
-- LAB RESULTS
-- ============================================================
CREATE TABLE lab_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  order_id       UUID NOT NULL REFERENCES lab_orders(id),
  order_item_id  UUID NOT NULL REFERENCES lab_order_items(id),
  patient_id     UUID NOT NULL REFERENCES patients(id),
  results        JSONB NOT NULL DEFAULT '[]',
  -- [{parameter, value, unit, ref_min, ref_max,
  --   flag: 'normal'|'low'|'high'|'critical'}]
  conclusion     TEXT,
  file_url       TEXT,
  -- Критические значения
  has_critical           BOOLEAN NOT NULL DEFAULT false,
  critical_notified_at   TIMESTAMPTZ,
  critical_notified_doctor UUID REFERENCES user_profiles(id),
  -- Редактирование (только owner)
  is_edited      BOOLEAN NOT NULL DEFAULT false,
  edit_history   JSONB NOT NULL DEFAULT '[]',
  -- [{edited_by, edited_at, old_results, reason}]
  -- Исполнение
  performed_by   UUID REFERENCES user_profiles(id),
  verified_by    UUID REFERENCES user_profiles(id),
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Авто-флаг критических значений
CREATE OR REPLACE FUNCTION flag_critical_results()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE has_crit BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(NEW.results) r
    WHERE r->>'flag' = 'critical'
  ) INTO has_crit;
  NEW.has_critical := has_crit;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_flag_critical
  BEFORE INSERT OR UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION flag_critical_results();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE lab_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_categories: read"          ON lab_categories     FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "lab_test_templates: own clinic" ON lab_test_templates FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "lab_panels: own clinic"         ON lab_panels         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "lab_orders: own clinic"         ON lab_orders         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "lab_order_items: own clinic"    ON lab_order_items    FOR ALL USING (
  order_id IN (SELECT id FROM lab_orders WHERE clinic_id = current_clinic_id())
);
CREATE POLICY "lab_results: own clinic"        ON lab_results        FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_lab_orders_clinic   ON lab_orders(clinic_id, status);
CREATE INDEX idx_lab_orders_patient  ON lab_orders(patient_id, ordered_at DESC);
CREATE INDEX idx_lab_orders_visit    ON lab_orders(visit_id);
CREATE INDEX idx_lab_results_order   ON lab_results(order_id);
CREATE INDEX idx_lab_results_patient ON lab_results(patient_id, completed_at DESC);
CREATE INDEX idx_lab_results_critical ON lab_results(clinic_id) WHERE has_critical = true;
