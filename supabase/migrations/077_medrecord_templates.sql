-- ============================================================
-- 077_medrecord_templates.sql
-- Шаблоны медицинских записей (по нозологии/жалобе).
-- Один шаблон = пресет всех полей визита: жалобы, анамнез,
-- объективно, рекомендации + набор назначений.
-- ============================================================

CREATE TABLE IF NOT EXISTS medrecord_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id       UUID REFERENCES doctors(id) ON DELETE CASCADE,
  -- doctor_id NULL → общеклинический шаблон
  name            TEXT NOT NULL,
  icd10_code      TEXT,
  icd10_name      TEXT,
  complaints      TEXT,
  anamnesis       TEXT,
  objective       TEXT,
  diagnosis_text  TEXT,
  recommendations TEXT,
  prescriptions   JSONB NOT NULL DEFAULT '[]',
  use_count       INT  NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medrec_tpl_doctor
  ON medrecord_templates(doctor_id, use_count DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_medrec_tpl_clinic
  ON medrecord_templates(clinic_id, use_count DESC) WHERE is_active;

ALTER TABLE medrecord_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "medrec_tpl: own clinic" ON medrecord_templates;
CREATE POLICY "medrec_tpl: own clinic"
  ON medrecord_templates
  FOR ALL
  USING (clinic_id = current_clinic_id());
