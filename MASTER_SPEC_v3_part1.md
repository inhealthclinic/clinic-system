# IN HEALTH — MASTER SPEC v3.0 (Production-Ready)
> Объединяет Architecture v1.0 + ТЗ v3.0  
> Стек: Next.js 16 · Supabase (PostgreSQL 15) · TypeScript 5 · Tailwind · shadcn/ui  
> Дата: 2026-04-14

---

## ПРИНЦИПЫ

| # | Правило |
|---|---------|
| 1 | 1 пациент = 1 профиль навсегда |
| 2 | Пациент — центр всех данных |
| 3 | Appointment = план; Visit = факт |
| 4 | Charge = начисление; Payment = оплата (разделены) |
| 5 | Депозит общий — списывается с любого визита |
| 6 | Ничего не удаляется (soft-delete, только owner) |
| 7 | Все действия пишутся в activity_log |

---

## ГЛАВНАЯ ЦЕПОЧКА

```
Patient → Deal → Appointment → Visit → Charge → Payment
                                   ↓               ↓
                              Inventory       PatientBalance
                              (списание)      (депозит)
```

---

## ЧАСТЬ 1 — БАЗА ДАННЫХ

### 1. clinics
```sql
CREATE TABLE clinics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  logo_url    TEXT,
  timezone    TEXT DEFAULT 'Asia/Almaty',
  currency    TEXT DEFAULT 'KZT',
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

---

### 2. RBAC

```sql
-- Роли (гибкие, создаются owner)
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,          -- owner/admin/doctor/nurse/laborant/cashier/manager
  is_system   BOOLEAN DEFAULT false,
  color       TEXT DEFAULT '#6B7280',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(clinic_id, slug)
);

-- Все права системы
CREATE TABLE permissions (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module  TEXT NOT NULL,   -- patients/crm/schedule/visit/medcard/lab/finance/inventory/analytics/settings
  action  TEXT NOT NULL,   -- view/create/edit/delete/export/approve/sign
  name    TEXT NOT NULL,
  UNIQUE(module, action)
);

-- Роль ↔ право
CREATE TABLE role_permissions (
  role_id       UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

-- Пользователи
CREATE TABLE user_profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id),
  clinic_id          UUID REFERENCES clinics(id),
  role_id            UUID REFERENCES roles(id),
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  middle_name        TEXT,
  phone              TEXT,
  avatar_url         TEXT,
  is_active          BOOLEAN DEFAULT true,
  extra_permissions  UUID[] DEFAULT '{}',
  denied_permissions UUID[] DEFAULT '{}',
  last_login         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
```

**Матрица прав (сокращённая):**

| Право | owner | admin | doctor | nurse | laborant | cashier | manager |
|-------|:-----:|:-----:|:------:|:-----:|:--------:|:-------:|:-------:|
| patients:* | ✅ | ✅ | view | view+edit | ❌ | ❌ | ✅ |
| medcard:sign | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| lab:verify | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| lab:edit_result | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| finance:reports | ✅ | ✅ | ❌ | ❌ | ❌ | view | ❌ |
| finance:refund | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| inventory:writeoff | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| settings:roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| records:delete | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

### 3. Врачи

```sql
CREATE TABLE specializations (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT
);

CREATE TABLE doctors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID REFERENCES clinics(id),
  user_id               UUID REFERENCES user_profiles(id),
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  middle_name           TEXT,
  specialization_id     UUID REFERENCES specializations(id),
  photo_url             TEXT,
  phone                 TEXT,
  color                 TEXT DEFAULT '#3B82F6',
  working_hours         JSONB DEFAULT '{}',
  -- {"mon":[{"from":"09:00","to":"18:00"}], "tue":[], ...}
  consultation_duration INT DEFAULT 30,
  is_active             BOOLEAN DEFAULT true,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

---

### 4. Пациенты

```sql
CREATE TABLE patients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID REFERENCES clinics(id),
  -- Персона
  full_name      TEXT NOT NULL,
  phones         TEXT[] DEFAULT '{}',      -- несколько телефонов
  iin            TEXT,                      -- ИИН (Казахстан, опционально)
  gender         TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  birth_date     DATE,
  city           TEXT,
  email          TEXT,
  address        TEXT,
  -- Статус
  status         TEXT DEFAULT 'new'
                   CHECK (status IN ('new','active','in_treatment','completed','lost','vip')),
  tags           TEXT[] DEFAULT '{}',
  -- CRM-ответственные
  first_owner_id UUID REFERENCES user_profiles(id),  -- кто первый взял лид
  manager_id     UUID REFERENCES user_profiles(id),
  doctor_id      UUID REFERENCES doctors(id),
  -- Финансы (денормализованы для быстрого чтения)
  balance_amount DECIMAL(12,2) DEFAULT 0,
  debt_amount    DECIMAL(12,2) DEFAULT 0,
  -- Источник
  source         TEXT,                      -- 'instagram','2gis','referral','website','walk-in'
  source_id      UUID REFERENCES patient_sources(id),
  referrer_id    UUID REFERENCES patients(id), -- кто направил
  is_vip         BOOLEAN DEFAULT false,
  notes          TEXT,
  patient_number TEXT UNIQUE,
  -- Soft delete
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Автономер карты
CREATE SEQUENCE patient_number_seq START 1000;
CREATE OR REPLACE FUNCTION auto_patient_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.patient_number IS NULL THEN
    NEW.patient_number := 'P-' || LPAD(nextval('patient_number_seq')::TEXT, 6, '0');
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_patient_number BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION auto_patient_number();

CREATE TABLE patient_sources (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT
);

-- Full-text search индекс
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_patients_search ON patients USING GIN (
  (full_name || ' ' || COALESCE(iin,'') || ' ' || array_to_string(phones,' ')) gin_trgm_ops
);
```

---

### 5. CRM — Сделки

```sql
-- Воронка 1: Лиды
-- NEW → IN_PROGRESS → CONTACT → BOOKED
-- Воронка 2: Медицинская
-- BOOKED → CONFIRMED → ARRIVED → IN_VISIT → COMPLETED → FOLLOW_UP → REPEAT

CREATE TABLE deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID REFERENCES clinics(id),
  patient_id      UUID REFERENCES patients(id),
  funnel          TEXT NOT NULL CHECK (funnel IN ('leads','medical')),
  stage           TEXT NOT NULL,
  -- leads:    new / in_progress / contact / booked
  -- medical:  booked / confirmed / arrived / in_visit / completed / follow_up / repeat
  source          TEXT CHECK (source IN ('target','referral','repeat','organic','other')),
  priority        TEXT DEFAULT 'warm' CHECK (priority IN ('hot','warm','cold')),
  first_owner_id  UUID REFERENCES user_profiles(id),
  closer_id       UUID REFERENCES user_profiles(id),
  lost_reason     TEXT CHECK (lost_reason IN ('expensive','no_time','no_answer','not_ready','other')),
  lost_notes      TEXT,
  -- SLA (вычисляются триггером)
  first_response_at   TIMESTAMPTZ,
  booked_at           TIMESTAMPTZ,
  time_to_response_s  INT,   -- секунд до первого ответа
  time_to_booking_s   INT,   -- секунд до записи
  -- Мета
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- История смен стадии
CREATE TABLE deal_stage_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID REFERENCES deals(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  changed_by UUID REFERENCES user_profiles(id),
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Взаимодействия (звонки, сообщения, заметки)
CREATE TABLE crm_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  deal_id     UUID REFERENCES deals(id),
  patient_id  UUID REFERENCES patients(id),
  type        TEXT NOT NULL CHECK (type IN ('call','whatsapp','email','sms','note','visit')),
  direction   TEXT CHECK (direction IN ('inbound','outbound')),
  summary     TEXT NOT NULL,
  outcome     TEXT,
  duration_s  INT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

### 6. Запись (Appointment — план)

```sql
CREATE TABLE services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  category_id  UUID REFERENCES service_categories(id),
  name         TEXT NOT NULL,
  code         TEXT,
  price        DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_min INT DEFAULT 30,
  is_active    BOOLEAN DEFAULT true,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE service_categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id),
  name      TEXT NOT NULL,
  sort      INT DEFAULT 0
);

CREATE TABLE appointments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  patient_id   UUID REFERENCES patients(id),
  doctor_id    UUID REFERENCES doctors(id),
  deal_id      UUID REFERENCES deals(id),
  service_id   UUID REFERENCES services(id),
  -- Время
  date         DATE NOT NULL,
  time_start   TIME NOT NULL,
  time_end     TIME NOT NULL,     -- = time_start + service.duration_min
  duration_min INT NOT NULL,
  -- Статус
  status       TEXT DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','rescheduled','cancelled','no_show','completed')),
  cancel_reason    TEXT,
  reschedule_from  UUID REFERENCES appointments(id),
  -- Источник записи
  source       TEXT DEFAULT 'admin' CHECK (source IN ('admin','online','whatsapp','phone')),
  notes        TEXT,
  -- Уведомления
  reminder_sent_24h BOOLEAN DEFAULT false,
  reminder_sent_2h  BOOLEAN DEFAULT false,
  -- Мета
  created_by   UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- БИЗНЕС-ПРАВИЛО: конфликт врача
-- Уникальный constraint реализован через функцию:
CREATE OR REPLACE FUNCTION check_doctor_conflict(
  p_doctor_id UUID, p_date DATE, p_start TIME, p_end TIME, p_exclude_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM appointments
    WHERE doctor_id = p_doctor_id
      AND date = p_date
      AND status NOT IN ('cancelled','no_show')
      AND id IS DISTINCT FROM p_exclude_id
      AND time_start < p_end
      AND time_end > p_start
  );
$$ LANGUAGE sql;

-- Блокировки врача (отпуск, больничный)
CREATE TABLE schedule_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  doctor_id   UUID REFERENCES doctors(id),
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  reason      TEXT CHECK (reason IN ('vacation','sick','training','other')),
  notes       TEXT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

### 7. Визит (Visit — факт)

```sql
CREATE TABLE visits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID REFERENCES clinics(id),
  appointment_id   UUID REFERENCES appointments(id) UNIQUE,
  patient_id       UUID REFERENCES patients(id),
  doctor_id        UUID REFERENCES doctors(id),
  status           TEXT DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','completed','partial')),
  -- Время фактическое
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  -- Валидация при закрытии
  has_charges      BOOLEAN DEFAULT false,   -- есть хотя бы 1 начисление
  finance_settled  BOOLEAN DEFAULT false,   -- оплата/долг зафиксированы
  -- Мета
  notes            TEXT,
  created_by       UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- БИЗНЕС-ПРАВИЛО: нельзя закрыть визит без:
-- 1. has_charges = true
-- 2. finance_settled = true
-- 3. Есть medical_record (хотя бы статус задан)
CREATE OR REPLACE FUNCTION validate_visit_close(p_visit_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT) AS $$
DECLARE v visits%ROWTYPE;
BEGIN
  SELECT * INTO v FROM visits WHERE id = p_visit_id;
  IF NOT v.has_charges THEN
    RETURN QUERY SELECT false, 'Нет ни одного начисления';
  ELSIF NOT v.finance_settled THEN
    RETURN QUERY SELECT false, 'Финансы не зафиксированы';
  ELSIF NOT EXISTS(SELECT 1 FROM medical_records WHERE visit_id = p_visit_id) THEN
    RETURN QUERY SELECT false, 'Не заполнена медкарта';
  ELSE
    RETURN QUERY SELECT true, NULL;
  END IF;
END; $$ LANGUAGE plpgsql;
```

---

### 8. Медицинская карта

```sql
-- Базовые данные (1 на пациента)
CREATE TABLE medical_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID REFERENCES patients(id) UNIQUE,
  clinic_id   UUID REFERENCES clinics(id),
  blood_type  TEXT,
  rh_factor   TEXT CHECK (rh_factor IN ('+','-')),
  height_cm   DECIMAL(5,1),
  weight_kg   DECIMAL(5,1),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Аллергии
CREATE TABLE allergies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID REFERENCES patients(id) ON DELETE CASCADE,
  allergen    TEXT NOT NULL,
  type        TEXT CHECK (type IN ('drug','food','environmental','other')),
  severity    TEXT CHECK (severity IN ('mild','moderate','severe','life-threatening')),
  reaction    TEXT,
  confirmed   BOOLEAN DEFAULT false,
  noted_at    DATE,
  doctor_id   UUID REFERENCES doctors(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Хронические заболевания
CREATE TABLE chronic_conditions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID REFERENCES patients(id) ON DELETE CASCADE,
  icd10_code   TEXT,
  name         TEXT NOT NULL,
  diagnosed_at DATE,
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','remission','resolved')),
  doctor_id    UUID REFERENCES doctors(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Семейный анамнез
CREATE TABLE family_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL,  -- father/mother/sibling/grandparent
  condition  TEXT NOT NULL,
  icd10_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Социальный анамнез (1 на пациента)
CREATE TABLE social_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(id) UNIQUE,
  smoking       TEXT DEFAULT 'never' CHECK (smoking IN ('never','former','current')),
  smoking_packs DECIMAL(3,1),
  alcohol       TEXT DEFAULT 'none' CHECK (alcohol IN ('none','occasional','regular','heavy')),
  drugs         TEXT DEFAULT 'none',
  occupation    TEXT,
  notes         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Прививки
CREATE TABLE vaccinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_name    TEXT NOT NULL,
  dose_number     INT DEFAULT 1,
  administered_at DATE NOT NULL,
  next_due_at     DATE,
  batch_number    TEXT,
  doctor_id       UUID REFERENCES doctors(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- МКБ-10 справочник (72k строк, seed)
CREATE TABLE icd10_codes (
  code   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  block  TEXT,
  fts    TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('russian', name || ' ' || code)
  ) STORED
);
CREATE INDEX idx_icd10_fts ON icd10_codes USING GIN(fts);

-- Медицинская запись (1 на визит)
CREATE TABLE medical_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        UUID REFERENCES visits(id) UNIQUE,
  patient_id      UUID REFERENCES patients(id),
  doctor_id       UUID REFERENCES doctors(id),
  clinic_id       UUID REFERENCES clinics(id),
  template        TEXT,   -- therapy/endocrinology/gynecology/cardiology/urology/anemia/thyroid/weight_loss
  -- Субъективно
  complaints      TEXT,
  anamnesis       TEXT,
  -- Объективно
  objective       TEXT,
  vitals          JSONB DEFAULT '{}',
  -- {temperature, pulse, bp_systolic, bp_diastolic, spo2, weight, height, glucose}
  -- Диагноз
  icd10_code      TEXT REFERENCES icd10_codes(code),
  icd10_secondary TEXT[],
  diagnosis_text  TEXT,
  diagnosis_type  TEXT DEFAULT 'preliminary' CHECK (diagnosis_type IN ('preliminary','final')),
  -- Лечение
  prescriptions   JSONB DEFAULT '[]',
  -- [{drug_name, dosage, form, frequency, duration, route, instructions}]
  recommendations TEXT,
  treatment_plan  TEXT,
  control_date    DATE,
  -- Подпись врача
  is_signed       BOOLEAN DEFAULT false,
  signed_at       TIMESTAMPTZ,
  -- Мета
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Направления
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id       UUID REFERENCES medical_records(id),
  patient_id      UUID REFERENCES patients(id),
  from_doctor_id  UUID REFERENCES doctors(id),
  to_doctor_id    UUID REFERENCES doctors(id),
  to_specialist   TEXT,
  to_institution  TEXT,
  reason          TEXT NOT NULL,
  urgency         TEXT DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','emergency')),
  issued_at       TIMESTAMPTZ DEFAULT now(),
  expires_at      DATE,
  status          TEXT DEFAULT 'issued' CHECK (status IN ('issued','used','expired'))
);

-- Вложения к записи
CREATE TABLE record_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    UUID REFERENCES medical_records(id) ON DELETE CASCADE,
  patient_id   UUID REFERENCES patients(id),
  name         TEXT NOT NULL,
  file_url     TEXT NOT NULL,
  file_type    TEXT,
  category     TEXT CHECK (category IN ('xray','mri','ultrasound','ecg','photo','document','other')),
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

### 9. Лаборатория

```sql
-- Категории и шаблоны анализов
CREATE TABLE lab_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT
);

CREATE TABLE lab_test_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  category_id  UUID REFERENCES lab_categories(id),
  name         TEXT NOT NULL,
  code         TEXT,
  turnaround_h INT DEFAULT 24,
  price        DECIMAL(10,2),
  parameters   JSONB NOT NULL DEFAULT '[]',
  -- [{
  --   name, unit,
  --   ref_min, ref_max,         -- общий диапазон
  --   ref_gender: {male:{min,max}, female:{min,max}},
  --   ref_age: [{age_from, age_to, min, max}],
  --   ref_pregnancy: {min, max},
  --   method,                   -- метод измерения
  --   critical_low, critical_high
  -- }]
  is_active    BOOLEAN DEFAULT true
);

-- Панели (наборы анализов)
CREATE TABLE lab_panels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  name        TEXT NOT NULL,  -- anemia/thyroid/checkup/metabolic/female_health
  template_ids UUID[] NOT NULL,
  price       DECIMAL(10,2)
);

-- Направление на анализ
CREATE TABLE lab_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID REFERENCES clinics(id),
  patient_id      UUID REFERENCES patients(id),
  visit_id        UUID REFERENCES visits(id),
  doctor_id       UUID REFERENCES doctors(id),
  order_number    TEXT UNIQUE,
  status          TEXT DEFAULT 'ordered'
                    CHECK (status IN ('ordered','agreed','paid','sample_taken','in_progress','ready','verified','delivered')),
  urgent          BOOLEAN DEFAULT false,
  external_lab    TEXT,
  tracking_number TEXT,
  notes           TEXT,
  ordered_at      TIMESTAMPTZ DEFAULT now(),
  sample_taken_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES user_profiles(id),
  created_by      UUID REFERENCES user_profiles(id)
);

CREATE TABLE lab_order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID REFERENCES lab_orders(id) ON DELETE CASCADE,
  template_id  UUID REFERENCES lab_test_templates(id),
  name         TEXT NOT NULL,
  price        DECIMAL(10,2),
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed'))
);

-- Результаты
CREATE TABLE lab_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES lab_orders(id),
  order_item_id UUID REFERENCES lab_order_items(id),
  patient_id    UUID REFERENCES patients(id),
  results       JSONB NOT NULL DEFAULT '[]',
  -- [{parameter, value, unit, ref_min, ref_max, flag: normal|low|high|critical}]
  conclusion    TEXT,
  file_url      TEXT,
  -- Редактирование (только owner)
  is_edited     BOOLEAN DEFAULT false,
  edit_history  JSONB DEFAULT '[]',
  -- [{edited_by, edited_at, old_value, new_value, reason}]
  performed_by  UUID REFERENCES user_profiles(id),
  verified_by   UUID REFERENCES user_profiles(id),
  completed_at  TIMESTAMPTZ DEFAULT now()
);

-- Сравнение результатов (представление)
CREATE VIEW lab_results_history AS
SELECT
  lr.patient_id,
  li.name as test_name,
  lo.order_number,
  lo.ordered_at,
  lr.results,
  lr.conclusion
FROM lab_results lr
JOIN lab_orders lo ON lo.id = lr.order_id
JOIN lab_order_items li ON li.id = lr.order_item_id
ORDER BY lr.patient_id, li.name, lo.ordered_at;
```

---

### 10. Финансы — 3 уровня

```sql
-- УРОВЕНЬ 1: Начисление (Charge)
CREATE TABLE charges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  visit_id    UUID REFERENCES visits(id),
  patient_id  UUID REFERENCES patients(id),
  service_id  UUID REFERENCES services(id),
  lab_item_id UUID REFERENCES lab_order_items(id),
  name        TEXT NOT NULL,
  quantity    INT DEFAULT 1,
  unit_price  DECIMAL(10,2) NOT NULL,
  discount    DECIMAL(10,2) DEFAULT 0,
  total       DECIMAL(10,2) NOT NULL,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','partial','cancelled')),
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- УРОВЕНЬ 2: Оплата (Payment)
CREATE TABLE payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  charge_id   UUID REFERENCES charges(id),
  patient_id  UUID REFERENCES patients(id),
  session_id  UUID REFERENCES cash_sessions(id),
  amount      DECIMAL(10,2) NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('cash','kaspi','halyk','credit','balance')),
  type        TEXT NOT NULL CHECK (type IN ('payment','prepayment','refund','writeoff')),
  refund_reason TEXT,   -- обязателен при type=refund
  reference   TEXT,
  notes       TEXT,
  received_by UUID REFERENCES user_profiles(id),
  paid_at     TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- УРОВЕНЬ 3: Депозит пациента (PatientBalance)
CREATE TABLE patient_balance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID REFERENCES patients(id) UNIQUE,
  clinic_id   UUID REFERENCES clinics(id),
  balance     DECIMAL(12,2) DEFAULT 0
);

-- Движения депозита
CREATE TABLE balance_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID REFERENCES patients(id),
  clinic_id   UUID REFERENCES clinics(id),
  type        TEXT NOT NULL CHECK (type IN ('topup','deduct','refund')),
  amount      DECIMAL(10,2) NOT NULL,
  payment_id  UUID REFERENCES payments(id),
  charge_id   UUID REFERENCES charges(id),
  notes       TEXT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Кассовые смены
CREATE TABLE cash_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  opened_by     UUID REFERENCES user_profiles(id),
  closed_by     UUID REFERENCES user_profiles(id),
  opening_cash  DECIMAL(10,2) DEFAULT 0,
  closing_cash  DECIMAL(10,2),
  expected_cash DECIMAL(10,2),
  difference    DECIMAL(10,2),
  status        TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at     TIMESTAMPTZ DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  notes         TEXT
);

-- ПРАВИЛА (enforced в Edge Functions):
-- 1. Возврат требует причину
-- 2. Редактирование прошлых платежей — только owner
-- 3. Частичная оплата разрешена
-- 4. Смешанные методы (наличные + Kaspi) — разбивается на 2 Payment
-- 5. Списание с депозита = Payment{method:'balance'}
```

---

### 11. Склад

```sql
-- Реагенты (для лаборатории)
CREATE TABLE reagents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  name        TEXT NOT NULL,
  code        TEXT,
  unit        TEXT NOT NULL,   -- ml/g/pieces
  min_stock   DECIMAL(10,3) DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Расходники (для процедур)
CREATE TABLE consumables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  name        TEXT NOT NULL,
  code        TEXT,
  unit        TEXT NOT NULL,
  min_stock   DECIMAL(10,3) DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Партии (FEFO — first expired, first out)
CREATE TABLE inventory_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  item_type     TEXT NOT NULL CHECK (item_type IN ('reagent','consumable')),
  item_id       UUID NOT NULL,   -- reagents.id или consumables.id
  batch_number  TEXT,
  quantity      DECIMAL(10,3) NOT NULL,
  remaining     DECIMAL(10,3) NOT NULL,
  unit_cost     DECIMAL(10,2),
  expires_at    DATE,
  received_at   DATE DEFAULT CURRENT_DATE,
  received_by   UUID REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Движения склада
CREATE TABLE inventory_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  batch_id    UUID REFERENCES inventory_batches(id),
  item_type   TEXT NOT NULL,
  item_id     UUID NOT NULL,
  type        TEXT NOT NULL
                CHECK (type IN ('incoming','writeoff_service','writeoff_lab','damaged','expired','correction','return')),
  quantity    DECIMAL(10,3) NOT NULL,
  visit_id    UUID REFERENCES visits(id),
  lab_order_id UUID REFERENCES lab_orders(id),
  reason      TEXT,
  -- Ручное списание — только owner
  is_manual   BOOLEAN DEFAULT false,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Шаблон списания для услуги
CREATE TABLE service_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID REFERENCES services(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL CHECK (item_type IN ('reagent','consumable')),
  item_id     UUID NOT NULL,
  qty         DECIMAL(10,3) NOT NULL
);

-- Автосписание при выполнении услуги (Edge Function trigger)
-- При charge.status → 'paid': списать по service_templates, FEFO
```

---

### 12. Задачи

```sql
CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  title        TEXT NOT NULL,
  description  TEXT,
  type         TEXT CHECK (type IN ('call','follow_up','confirm','reminder','lab_ready','control','other')),
  priority     TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status       TEXT DEFAULT 'new' CHECK (status IN ('new','in_progress','done','overdue','cancelled')),
  assigned_to  UUID REFERENCES user_profiles(id),
  created_by   UUID REFERENCES user_profiles(id),
  patient_id   UUID REFERENCES patients(id),
  deal_id      UUID REFERENCES deals(id),
  visit_id     UUID REFERENCES visits(id),
  due_at       TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Просроченные задачи — cron каждые 5 минут
-- UPDATE tasks SET status='overdue' WHERE due_at < now() AND status IN ('new','in_progress');
```

---

### 13. Activity Log (универсальный)

```sql
CREATE TABLE activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  entity_type  TEXT NOT NULL,
  -- patient/deal/appointment/visit/charge/payment/lab_order/inventory/task/user
  entity_id    UUID NOT NULL,
  action       TEXT NOT NULL,
  -- created/updated/deleted/stage_changed/status_changed/signed/paid/refunded/verified...
  user_id      UUID REFERENCES user_profiles(id),
  metadata     JSONB DEFAULT '{}',  -- {old, new, reason, ...}
  ip_address   INET,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Индексы для быстрой ленты
CREATE INDEX idx_activity_entity ON activity_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_activity_user   ON activity_logs(user_id, created_at DESC);
CREATE INDEX idx_activity_patient ON activity_logs(entity_type, entity_id)
  WHERE entity_type = 'patient';
```

---

### 14. Уведомления

```sql
CREATE TABLE notification_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  name         TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  -- appointment_reminder_24h / appointment_reminder_2h / lab_ready / no_show / birthday / control_date
  channel      TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  subject      TEXT,
  body         TEXT NOT NULL,
  -- Переменные: {{patient_name}} {{doctor_name}} {{date}} {{time}} {{clinic_name}} {{result_url}}
  send_before_min INT,
  is_active    BOOLEAN DEFAULT true
);

CREATE TABLE notifications_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID REFERENCES clinics(id),
  template_id    UUID REFERENCES notification_templates(id),
  patient_id     UUID REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  channel        TEXT NOT NULL,
  recipient      TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed')),
  provider_id    TEXT,
  error          TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

---

### 15. Ключевые индексы

```sql
-- Расписание
CREATE INDEX idx_appointments_doctor_date ON appointments(doctor_id, date, time_start)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX idx_appointments_patient ON appointments(patient_id, date DESC);

-- Визиты
CREATE INDEX idx_visits_patient ON visits(patient_id, created_at DESC);
CREATE INDEX idx_visits_status  ON visits(status, clinic_id);

-- Финансы
CREATE INDEX idx_charges_visit    ON charges(visit_id);
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at DESC);
CREATE INDEX idx_payments_session ON payments(session_id);

-- Склад
CREATE INDEX idx_batches_expires ON inventory_batches(item_type, item_id, expires_at)
  WHERE remaining > 0;

-- Задачи
CREATE INDEX idx_tasks_assigned   ON tasks(assigned_to, status, due_at);
CREATE INDEX idx_tasks_overdue    ON tasks(due_at) WHERE status IN ('new','in_progress');

-- Лога
CREATE INDEX idx_activity_clinic_date ON activity_logs(clinic_id, created_at DESC);
```

---

### 16. RLS (Row Level Security)

```sql
-- Включить RLS на все таблицы
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
-- ... (аналогично для всех таблиц)

-- Базовая политика: только своя клиника
CREATE POLICY clinic_isolation ON patients
  FOR ALL USING (
    clinic_id = (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  );

-- Функция проверки прав
CREATE OR REPLACE FUNCTION has_permission(p_user UUID, p_perm TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    -- Owner — всё разрешено
    (SELECT r.slug FROM user_profiles up JOIN roles r ON r.id=up.role_id WHERE up.id=p_user) = 'owner'
    OR (
      -- Право через роль
      EXISTS(
        SELECT 1 FROM user_profiles up
        JOIN role_permissions rp ON rp.role_id = up.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE up.id = p_user AND (p.module||':'||p.action) = p_perm
      )
      AND NOT (p_perm = ANY(
        SELECT unnest(denied_permissions::text[]) FROM user_profiles WHERE id = p_user
      ))
    )
    -- Дополнительное право
    OR p_perm = ANY(
      SELECT unnest(extra_permissions::text[]) FROM user_profiles WHERE id = p_user
    );
$$ LANGUAGE sql SECURITY DEFINER;

-- Врач видит только свои записи (если нет schedule:view_all)
CREATE POLICY doctor_own_appointments ON appointments
  FOR SELECT USING (
    doctor_id = (SELECT id FROM doctors WHERE user_id = auth.uid())
    OR has_permission(auth.uid(), 'schedule:view_all')
  );
```

---
*Конец части 1. Продолжение → MASTER_SPEC_v3_part2.md*
