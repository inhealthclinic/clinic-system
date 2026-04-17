-- ============================================================
-- 006_visits.sql
-- Визиты (факт приёма)
-- ============================================================

CREATE TABLE visits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES clinics(id),
  appointment_id   UUID REFERENCES appointments(id) UNIQUE,
  patient_id       UUID NOT NULL REFERENCES patients(id),
  doctor_id        UUID NOT NULL REFERENCES doctors(id),
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','completed','partial')),
  -- Время фактическое
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  -- Валидация (заполняется автоматически)
  has_charges      BOOLEAN NOT NULL DEFAULT false,
  finance_settled  BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_by       UUID REFERENCES user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_visits_updated_at
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ВАЛИДАТОР ЗАКРЫТИЯ ВИЗИТА
-- ============================================================
CREATE OR REPLACE FUNCTION validate_visit_close(p_visit_id UUID)
RETURNS TABLE(ok BOOLEAN, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE v visits%ROWTYPE;
BEGIN
  SELECT * INTO v FROM visits WHERE id = p_visit_id;
  IF NOT v.has_charges THEN
    RETURN QUERY SELECT false, 'Нет ни одного начисления';
  ELSIF NOT v.finance_settled THEN
    RETURN QUERY SELECT false, 'Финансы не зафиксированы (оплата или долг)';
  ELSIF NOT EXISTS(SELECT 1 FROM medical_records WHERE visit_id = p_visit_id) THEN
    RETURN QUERY SELECT false, 'Не заполнена медицинская запись';
  ELSE
    RETURN QUERY SELECT true, NULL::TEXT;
  END IF;
END;
$$;

-- При закрытии визита → синхронизировать статус appointment
CREATE OR REPLACE FUNCTION sync_appointment_on_visit_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed','partial') AND OLD.status NOT IN ('completed','partial') THEN
    UPDATE appointments SET status = 'completed', updated_at = now()
    WHERE id = NEW.appointment_id;
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  IF NEW.status = 'in_progress' AND OLD.status = 'open' THEN
    NEW.started_at := COALESCE(NEW.started_at, now());
    UPDATE appointments SET status = 'arrived', arrived_at = now()
    WHERE id = NEW.appointment_id AND status NOT IN ('arrived','completed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visit_close_sync
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION sync_appointment_on_visit_close();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visits: own clinic" ON visits
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "visits: doctor own" ON visits
  FOR SELECT USING (
    doctor_id = (SELECT id FROM doctors WHERE user_id = auth.uid() LIMIT 1)
    OR has_permission(auth.uid(), 'visit:view')
  );

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_visits_patient   ON visits(patient_id, created_at DESC);
CREATE INDEX idx_visits_doctor    ON visits(doctor_id, created_at DESC);
CREATE INDEX idx_visits_status    ON visits(clinic_id, status);
CREATE INDEX idx_visits_date      ON visits(clinic_id, created_at DESC);
