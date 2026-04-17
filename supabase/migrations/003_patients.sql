-- ============================================================
-- 003_patients.sql
-- Пациенты, источники, согласие на ПДн, дубли
-- ============================================================

-- ============================================================
-- PATIENT SOURCES (справочник источников)
-- ============================================================
CREATE TABLE patient_sources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,   -- 'Instagram', '2GIS', 'Сайт', 'Рекомендация'
  code       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, name)
);

-- ============================================================
-- PATIENTS
-- ============================================================
CREATE SEQUENCE patient_number_seq START 1000;

CREATE TABLE patients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Персональные данные
  full_name      TEXT NOT NULL,
  phones         TEXT[] NOT NULL DEFAULT '{}',     -- минимум 1 обязателен
  iin            TEXT,                              -- ИИН (опционально)
  gender         TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  birth_date     DATE,
  city           TEXT,
  email          TEXT,
  address        TEXT,
  -- Номер карты (авто)
  patient_number TEXT UNIQUE,
  -- Статус
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','active','in_treatment','completed','lost','vip')),
  tags           TEXT[] NOT NULL DEFAULT '{}',
  -- Ответственные
  first_owner_id UUID REFERENCES user_profiles(id),
  manager_id     UUID REFERENCES user_profiles(id),
  doctor_id      UUID REFERENCES doctors(id),
  -- Источник
  source_id      UUID REFERENCES patient_sources(id),
  source_text    TEXT,                              -- если источника нет в справочнике
  referrer_id    UUID REFERENCES patients(id),      -- кто направил
  -- Финансы (денормализованы для быстрого чтения)
  balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  debt_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- Флаги
  is_vip         BOOLEAN NOT NULL DEFAULT false,
  notes          TEXT,
  -- Soft delete
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Автогенерация номера карты
CREATE OR REPLACE FUNCTION auto_patient_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.patient_number IS NULL THEN
    NEW.patient_number := 'P-' || LPAD(nextval('patient_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patient_number
  BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION auto_patient_number();

CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Пересчёт баланса и долга при изменении платежей
-- (реализуется в Edge Function process-payment)

-- ============================================================
-- PATIENT CONSENTS (согласие на ПДн — обязательно по закону РК)
-- ============================================================
CREATE TABLE patient_consents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('personal_data','medical_processing','photo','marketing')),
  -- personal_data: обязательно, без него нельзя сохранить пациента
  version     TEXT NOT NULL DEFAULT '1.0',
  agreed      BOOLEAN NOT NULL,
  agreed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_by   UUID REFERENCES user_profiles(id),
  file_url    TEXT,          -- скан подписанного документа
  revoked_at  TIMESTAMPTZ,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PATIENT DUPLICATES (обнаружение и слияние)
-- ============================================================
CREATE TABLE patient_duplicates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  patient_id_1 UUID NOT NULL REFERENCES patients(id),  -- оставляем
  patient_id_2 UUID NOT NULL REFERENCES patients(id),  -- сливаем
  score        DECIMAL(4,3),                            -- степень схожести 0-1
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','merged','not_duplicate')),
  reviewed_by  UUID REFERENCES user_profiles(id),
  merged_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(patient_id_1, patient_id_2)
);

-- Функция поиска дублей (запускается при создании пациента)
CREATE OR REPLACE FUNCTION find_patient_duplicates(p_clinic_id UUID)
RETURNS TABLE(
  patient_id_1  UUID,
  patient_id_2  UUID,
  full_name_1   TEXT,
  full_name_2   TEXT,
  score         DECIMAL
)
LANGUAGE sql
AS $$
  SELECT
    p1.id, p2.id,
    p1.full_name, p2.full_name,
    similarity(p1.full_name, p2.full_name)::DECIMAL as score
  FROM patients p1
  JOIN patients p2
    ON p1.id < p2.id
    AND p1.clinic_id = p_clinic_id
    AND p2.clinic_id = p_clinic_id
    AND p1.deleted_at IS NULL
    AND p2.deleted_at IS NULL
  WHERE
    similarity(p1.full_name, p2.full_name) > 0.7
    OR (p1.birth_date = p2.birth_date AND p1.birth_date IS NOT NULL)
    OR (
      SELECT COUNT(*) FROM (
        SELECT unnest(p1.phones) INTERSECT SELECT unnest(p2.phones)
      ) t
    ) > 0
  ORDER BY score DESC;
$$;

-- Функция слияния дублей (только owner/admin)
CREATE OR REPLACE FUNCTION merge_patients(
  p_keep_id UUID,
  p_merge_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_keep_number TEXT;
BEGIN
  SELECT patient_number INTO v_keep_number FROM patients WHERE id = p_keep_id;

  -- Переносим все связи
  UPDATE appointments     SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE visits           SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE charges          SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE payments         SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE lab_orders       SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE medical_records  SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE deals            SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE crm_interactions SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE tasks            SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE patient_consents SET patient_id = p_keep_id WHERE patient_id = p_merge_id;

  -- Объединяем телефоны (убираем дубли)
  UPDATE patients SET
    phones = ARRAY(
      SELECT DISTINCT unnest(
        (SELECT phones FROM patients WHERE id = p_keep_id) ||
        (SELECT phones FROM patients WHERE id = p_merge_id)
      )
    )
  WHERE id = p_keep_id;

  -- Объединяем баланс
  UPDATE patient_balance SET
    balance = balance + COALESCE(
      (SELECT balance FROM patient_balance WHERE patient_id = p_merge_id), 0
    )
  WHERE patient_id = p_keep_id;

  -- Soft-delete дубля
  UPDATE patients SET
    deleted_at = now(),
    notes = COALESCE(notes,'') || ' | Объединён с ' || v_keep_number
  WHERE id = p_merge_id;

  -- Обновить статус в таблице дублей
  UPDATE patient_duplicates SET
    status = 'merged',
    reviewed_by = p_user_id,
    merged_at = now()
  WHERE (patient_id_1 = p_keep_id AND patient_id_2 = p_merge_id)
     OR (patient_id_1 = p_merge_id AND patient_id_2 = p_keep_id);

  -- Лог
  INSERT INTO activity_logs(entity_type, entity_id, action, user_id, metadata, clinic_id)
  SELECT 'patient', p_keep_id, 'merged', p_user_id,
    jsonb_build_object('merged_patient_id', p_merge_id),
    (SELECT clinic_id FROM patients WHERE id = p_keep_id);
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE patients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_sources   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients: own clinic" ON patients
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "patient_consents: own clinic" ON patient_consents
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "patient_duplicates: own clinic" ON patient_duplicates
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "patient_sources: own clinic" ON patient_sources
  FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
-- Полнотекстовый поиск по имени и телефону
CREATE INDEX idx_patients_search ON patients
  USING GIN (
    (full_name || ' ' || COALESCE(iin,'') || ' ' || array_to_string(phones,' '))
    gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX idx_patients_clinic  ON patients(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_status  ON patients(clinic_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_manager ON patients(manager_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_doctor  ON patients(doctor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_consents_patient ON patient_consents(patient_id, type);
