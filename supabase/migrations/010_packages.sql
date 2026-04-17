-- ============================================================
-- 010_packages.sql
-- Пакеты/курсы услуг
-- ============================================================

CREATE TABLE service_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  name          TEXT NOT NULL,
  description   TEXT,
  total_price   DECIMAL(10,2) NOT NULL,
  validity_days INT NOT NULL DEFAULT 365,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_package_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id),
  quantity   INT NOT NULL DEFAULT 1
);

-- Купленный пакет пациента
CREATE TABLE patient_packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  patient_id   UUID NOT NULL REFERENCES patients(id),
  package_id   UUID NOT NULL REFERENCES service_packages(id),
  payment_id   UUID REFERENCES payments(id),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,  -- purchased_at + validity_days
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','exhausted','expired','refunded')),
  notes        TEXT
);

-- Использование сеансов из пакета
CREATE TABLE patient_package_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_package_id UUID NOT NULL REFERENCES patient_packages(id),
  service_id         UUID NOT NULL REFERENCES services(id),
  visit_id           UUID REFERENCES visits(id),
  charge_id          UUID REFERENCES charges(id),
  used_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES user_profiles(id)
);

-- Авто expires_at при покупке пакета
CREATE OR REPLACE FUNCTION set_package_expires()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_days INT;
BEGIN
  SELECT validity_days INTO v_days FROM service_packages WHERE id = NEW.package_id;
  NEW.expires_at := NEW.purchased_at + (v_days || ' days')::INTERVAL;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_package_expires
  BEFORE INSERT ON patient_packages
  FOR EACH ROW EXECUTE FUNCTION set_package_expires();

-- Авто-истечение пакетов (вызывается cron каждый день)
CREATE OR REPLACE FUNCTION expire_packages()
RETURNS VOID LANGUAGE sql AS $$
  UPDATE patient_packages
  SET status = 'expired'
  WHERE status = 'active' AND expires_at < now();
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE service_packages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_packages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_package_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_packages: own clinic"      ON service_packages         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "service_package_items: own clinic" ON service_package_items    FOR ALL USING (package_id IN (SELECT id FROM service_packages WHERE clinic_id = current_clinic_id()));
CREATE POLICY "patient_packages: own clinic"      ON patient_packages         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "patient_package_sessions: own"     ON patient_package_sessions FOR ALL USING (patient_package_id IN (SELECT id FROM patient_packages WHERE clinic_id = current_clinic_id()));

CREATE INDEX idx_patient_packages_patient ON patient_packages(patient_id, status);
CREATE INDEX idx_patient_packages_expiry  ON patient_packages(expires_at) WHERE status = 'active';
