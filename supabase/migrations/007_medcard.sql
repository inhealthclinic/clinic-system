-- ============================================================
-- 007_medcard.sql
-- Медицинская карта, МКБ-10, записи приёма, шаблоны назначений
-- ============================================================

-- ============================================================
-- MEDICAL CARDS (базовые данные — 1 на пациента)
-- ============================================================
CREATE TABLE medical_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  patient_id  UUID NOT NULL REFERENCES patients(id) UNIQUE,
  blood_type  TEXT CHECK (blood_type IN ('0(I)','A(II)','B(III)','AB(IV)')),
  rh_factor   TEXT CHECK (rh_factor IN ('+','-')),
  height_cm   DECIMAL(5,1),
  weight_kg   DECIMAL(5,1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_medcard_updated_at
  BEFORE UPDATE ON medical_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ALLERGIES
-- ============================================================
CREATE TABLE allergies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen   TEXT NOT NULL,
  type       TEXT CHECK (type IN ('drug','food','environmental','other')),
  severity   TEXT CHECK (severity IN ('mild','moderate','severe','life-threatening')),
  reaction   TEXT,
  confirmed  BOOLEAN NOT NULL DEFAULT false,
  noted_at   DATE,
  doctor_id  UUID REFERENCES doctors(id),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DRUG ALLERGY GROUPS (синонимы для проверки при назначении)
-- ============================================================
CREATE TABLE drug_allergy_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name TEXT NOT NULL UNIQUE,
  drugs      TEXT[] NOT NULL
  -- {'пенициллин','амоксициллин','ампициллин','флемоксин'}
);

-- ============================================================
-- CHRONIC CONDITIONS
-- ============================================================
CREATE TABLE chronic_conditions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  patient_id   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  icd10_code   TEXT,
  name         TEXT NOT NULL,
  diagnosed_at DATE,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','remission','resolved')),
  doctor_id    UUID REFERENCES doctors(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FAMILY HISTORY
-- ============================================================
CREATE TABLE family_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL CHECK (relation IN ('father','mother','sibling','grandparent','other')),
  condition  TEXT NOT NULL,
  icd10_code TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SOCIAL HISTORY (1 на пациента)
-- ============================================================
CREATE TABLE social_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID NOT NULL REFERENCES patients(id) UNIQUE,
  smoking       TEXT NOT NULL DEFAULT 'never' CHECK (smoking IN ('never','former','current')),
  smoking_packs DECIMAL(3,1),
  alcohol       TEXT NOT NULL DEFAULT 'none'  CHECK (alcohol IN ('none','occasional','regular','heavy')),
  drugs         TEXT NOT NULL DEFAULT 'none',
  occupation    TEXT,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- VACCINATIONS
-- ============================================================
CREATE TABLE vaccinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_name    TEXT NOT NULL,
  dose_number     INT NOT NULL DEFAULT 1,
  administered_at DATE NOT NULL,
  next_due_at     DATE,
  batch_number    TEXT,
  doctor_id       UUID REFERENCES doctors(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ICD-10 СПРАВОЧНИК (72k записей — seed отдельно)
-- ============================================================
CREATE TABLE icd10_codes (
  code  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  block TEXT,
  fts   TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('russian', name || ' ' || code)
  ) STORED
);

CREATE INDEX idx_icd10_fts  ON icd10_codes USING GIN(fts);
CREATE INDEX idx_icd10_code ON icd10_codes(code text_pattern_ops);

-- ============================================================
-- MEDICAL RECORDS (запись приёма — 1 на визит)
-- ============================================================
CREATE SEQUENCE prescription_number_seq START 1000;

CREATE TABLE medical_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  visit_id         UUID NOT NULL REFERENCES visits(id) UNIQUE,
  patient_id       UUID NOT NULL REFERENCES patients(id),
  doctor_id        UUID NOT NULL REFERENCES doctors(id),
  -- Шаблон специализации
  template         TEXT CHECK (template IN (
    'therapy','endocrinology','gynecology','cardiology',
    'urology','anemia','thyroid','weight_loss','general'
  )),
  -- Субъективно
  complaints       TEXT,
  anamnesis        TEXT,
  -- Объективно
  objective        TEXT,
  vitals           JSONB NOT NULL DEFAULT '{}',
  -- {temperature, pulse, bp_systolic, bp_diastolic, spo2, weight, height, glucose, rr}
  -- Диагноз
  icd10_code       TEXT REFERENCES icd10_codes(code),
  icd10_secondary  TEXT[] NOT NULL DEFAULT '{}',
  diagnosis_text   TEXT,
  diagnosis_type   TEXT NOT NULL DEFAULT 'preliminary'
                     CHECK (diagnosis_type IN ('preliminary','final')),
  -- Назначения (JSONB для скорости; отдельная таблица prescription_templates для шаблонов)
  prescriptions    JSONB NOT NULL DEFAULT '[]',
  -- [{drug_name, dosage, form, frequency, duration, route, instructions, qty}]
  -- Рекомендации и план
  recommendations  TEXT,
  treatment_plan   TEXT,
  control_date     DATE,
  -- Подпись врача
  is_signed        BOOLEAN NOT NULL DEFAULT false,
  signed_at        TIMESTAMPTZ,
  prescription_number TEXT UNIQUE,   -- RX-2026-001234 (авто при подписи)
  -- Мета
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Автономер рецепта при подписи
CREATE OR REPLACE FUNCTION auto_prescription_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_signed = true AND OLD.is_signed = false THEN
    NEW.signed_at := now();
    NEW.prescription_number := 'RX-' || TO_CHAR(now(), 'YYYY') || '-' ||
      LPAD(nextval('prescription_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prescription_number
  BEFORE UPDATE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION auto_prescription_number();

CREATE TRIGGER trg_medical_records_updated_at
  BEFORE UPDATE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- REFERRALS (направления)
-- ============================================================
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  record_id       UUID REFERENCES medical_records(id),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  from_doctor_id  UUID NOT NULL REFERENCES doctors(id),
  to_doctor_id    UUID REFERENCES doctors(id),       -- внутри клиники
  to_specialist   TEXT,                               -- внешний специалист
  to_institution  TEXT,
  reason          TEXT NOT NULL,
  urgency         TEXT NOT NULL DEFAULT 'routine'
                    CHECK (urgency IN ('routine','urgent','emergency')),
  status          TEXT NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued','appointment_created','used','expired')),
  appointment_id  UUID REFERENCES appointments(id),  -- если сразу записали
  task_id         UUID REFERENCES tasks(id),          -- если отложили
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      DATE,
  notes           TEXT
);

-- ============================================================
-- RECORD ATTACHMENTS (снимки, файлы)
-- ============================================================
CREATE TABLE record_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  record_id   UUID REFERENCES medical_records(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id),
  name        TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  file_type   TEXT,
  category    TEXT CHECK (category IN ('xray','mri','ultrasound','ecg','photo','document','other')),
  size_bytes  BIGINT,
  uploaded_by UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRESCRIPTION TEMPLATES (шаблоны назначений врача)
-- ============================================================
CREATE TABLE prescription_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  doctor_id    UUID NOT NULL REFERENCES doctors(id),
  name         TEXT NOT NULL,
  drug_name    TEXT NOT NULL,
  dosage       TEXT NOT NULL,
  form         TEXT,
  frequency    TEXT NOT NULL,
  duration     TEXT,
  route        TEXT,
  instructions TEXT,
  use_count    INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE medical_cards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_allergy_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chronic_conditions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccinations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medical_cards: own clinic"          ON medical_cards          FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "allergies: own clinic"              ON allergies              FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "drug_allergy_groups: read"          ON drug_allergy_groups    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "chronic_conditions: own clinic"     ON chronic_conditions     FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "family_history: own clinic"         ON family_history         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "social_history: own clinic"         ON social_history         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "vaccinations: own clinic"           ON vaccinations           FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "medical_records: own clinic"        ON medical_records        FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "referrals: own clinic"              ON referrals              FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "record_attachments: own clinic"     ON record_attachments     FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "prescription_templates: own clinic" ON prescription_templates FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_medical_records_patient  ON medical_records(patient_id, created_at DESC);
CREATE INDEX idx_medical_records_visit    ON medical_records(visit_id);
CREATE INDEX idx_allergies_patient        ON allergies(patient_id);
CREATE INDEX idx_chronic_patient          ON chronic_conditions(patient_id);
CREATE INDEX idx_referrals_patient        ON referrals(patient_id, issued_at DESC);
CREATE INDEX idx_attachments_record       ON record_attachments(record_id);
CREATE INDEX idx_attachments_patient      ON record_attachments(patient_id);
CREATE INDEX idx_presc_templates_doctor   ON prescription_templates(doctor_id, use_count DESC);
