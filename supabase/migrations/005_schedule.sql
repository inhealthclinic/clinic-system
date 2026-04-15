-- ============================================================
-- 005_schedule.sql
-- Услуги, расписание, записи (Appointment)
-- ============================================================

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================
CREATE TABLE service_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, name)
);

-- ============================================================
-- SERVICES (прайс-лист)
-- ============================================================
CREATE TABLE services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES service_categories(id),
  name         TEXT NOT NULL,
  code         TEXT,
  price        DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_min INT NOT NULL DEFAULT 30,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SCHEDULE BLOCKS (отпуск, больничный врача)
-- ============================================================
CREATE TABLE schedule_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  doctor_id   UUID NOT NULL REFERENCES doctors(id),
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  reason      TEXT CHECK (reason IN ('vacation','sick','training','other')),
  notes       TEXT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- APPOINTMENTS (план — запись к врачу)
-- ============================================================
CREATE TABLE appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id),
  patient_id        UUID NOT NULL REFERENCES patients(id),
  doctor_id         UUID NOT NULL REFERENCES doctors(id),
  deal_id           UUID REFERENCES deals(id),
  service_id        UUID REFERENCES services(id),
  -- Время
  date              DATE NOT NULL,
  time_start        TIME NOT NULL,
  time_end          TIME NOT NULL,
  duration_min      INT NOT NULL,
  -- Статус
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending','confirmed','arrived',
                        'rescheduled','cancelled','no_show','completed'
                      )),
  arrived_at        TIMESTAMPTZ,
  cancel_reason     TEXT,
  reschedule_from   UUID REFERENCES appointments(id),
  -- Walk-in
  is_walkin         BOOLEAN NOT NULL DEFAULT false,
  -- Источник
  source            TEXT NOT NULL DEFAULT 'admin'
                      CHECK (source IN ('admin','online','whatsapp','phone')),
  notes             TEXT,
  -- Напоминания
  reminder_sent_24h BOOLEAN NOT NULL DEFAULT false,
  reminder_sent_2h  BOOLEAN NOT NULL DEFAULT false,
  -- Мета
  created_by        UUID REFERENCES user_profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ПРОВЕРКА КОНФЛИКТОВ ВРАЧА
-- ============================================================
CREATE OR REPLACE FUNCTION check_doctor_conflict(
  p_doctor_id  UUID,
  p_date       DATE,
  p_start      TIME,
  p_end        TIME,
  p_exclude_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM appointments
    WHERE doctor_id   = p_doctor_id
      AND date        = p_date
      AND status NOT IN ('cancelled','no_show','rescheduled')
      AND id IS DISTINCT FROM p_exclude_id
      AND time_start  < p_end
      AND time_end    > p_start
  );
$$;

-- ============================================================
-- АВТОСОЗДАНИЕ ВИЗИТА ПРИ СОЗДАНИИ ЗАПИСИ
-- ============================================================
CREATE OR REPLACE FUNCTION auto_create_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Создаём Visit для каждого нового Appointment
  INSERT INTO visits(clinic_id, appointment_id, patient_id, doctor_id, status, created_by)
  VALUES(
    NEW.clinic_id,
    NEW.id,
    NEW.patient_id,
    NEW.doctor_id,
    CASE WHEN NEW.is_walkin THEN 'in_progress' ELSE 'open' END,
    NEW.created_by
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_visit
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION auto_create_visit();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_blocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_categories: own clinic" ON service_categories FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "services: own clinic"           ON services           FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "schedule_blocks: own clinic"    ON schedule_blocks    FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "appointments: own clinic"       ON appointments       FOR ALL USING (clinic_id = current_clinic_id());

-- Врач видит только свои записи (если нет schedule:view_all)
CREATE POLICY "appointments: doctor own" ON appointments
  FOR SELECT USING (
    doctor_id = (SELECT id FROM doctors WHERE user_id = auth.uid() LIMIT 1)
    OR has_permission(auth.uid(), 'schedule:view_all')
  );

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_appointments_doctor_date ON appointments(doctor_id, date, time_start)
  WHERE status NOT IN ('cancelled','no_show','rescheduled');
CREATE INDEX idx_appointments_patient     ON appointments(patient_id, date DESC);
CREATE INDEX idx_appointments_date_clinic ON appointments(clinic_id, date)
  WHERE status NOT IN ('cancelled','no_show','rescheduled');
CREATE INDEX idx_schedule_blocks_doctor   ON schedule_blocks(doctor_id, date_from, date_to);
CREATE INDEX idx_services_clinic          ON services(clinic_id) WHERE deleted_at IS NULL;
