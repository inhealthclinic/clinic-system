-- ============================================================
-- 002_doctors.sql
-- Специализации и врачи
-- ============================================================

-- ============================================================
-- SPECIALIZATIONS (справочник)
-- ============================================================
CREATE TABLE specializations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, name)
);

-- ============================================================
-- DOCTORS
-- ============================================================
CREATE TABLE doctors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Врач = пользователь системы (NOT NULL — обязательно)
  user_id               UUID NOT NULL REFERENCES user_profiles(id),
  specialization_id     UUID REFERENCES specializations(id),
  -- Персональные данные (дублируем из user_profiles для удобства)
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  middle_name           TEXT,
  photo_url             TEXT,
  phone                 TEXT,
  -- UI
  color                 TEXT NOT NULL DEFAULT '#3B82F6',
  -- Рабочие часы (по дням недели)
  working_hours         JSONB NOT NULL DEFAULT '{}',
  -- { "mon":[{"from":"09:00","to":"18:00"}], "tue":[], "wed":..., ... }
  consultation_duration INT NOT NULL DEFAULT 30,   -- минут по умолчанию
  -- Образование и сертификаты
  education             JSONB NOT NULL DEFAULT '[]',
  -- [{degree, institution, year}]
  certificates          JSONB NOT NULL DEFAULT '[]',
  -- [{name, number, issued_at, expires_at}]
  bio                   TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, user_id)
);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER trg_doctors_updated_at
  BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE specializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "specializations: own clinic" ON specializations
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "doctors: own clinic" ON doctors
  FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_doctors_clinic  ON doctors(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_doctors_user    ON doctors(user_id);

-- ============================================================
-- SEED — базовые специализации (добавляются при создании клиники)
-- ============================================================
-- Вставляются через Edge Function при onboarding
-- Примеры: Терапевт, Кардиолог, Эндокринолог, Гинеколог, Уролог, Педиатр
