-- ============================================================
-- 013_notifications.sql
-- Шаблоны уведомлений и лог отправки
-- ============================================================

CREATE TABLE notification_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id),
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN (
    'appointment_reminder_24h','appointment_reminder_2h',
    'appointment_confirmed','appointment_cancelled',
    'lab_ready','lab_critical','lab_rejected',
    'birthday','control_date','debt_reminder','other'
  )),
  channel         TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  subject         TEXT,
  body            TEXT NOT NULL,
  -- Переменные: {{patient_name}} {{doctor_name}} {{date}} {{time}}
  --             {{clinic_name}} {{result_url}} {{amount}} {{order_number}}
  send_before_min INT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  template_id    UUID REFERENCES notification_templates(id),
  patient_id     UUID REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  lab_order_id   UUID REFERENCES lab_orders(id),
  channel        TEXT NOT NULL,
  recipient      TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','delivered','failed')),
  provider_id    TEXT,
  error          TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_log      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_templates: own clinic" ON notification_templates FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "notif_log: own clinic"       ON notifications_log      FOR ALL USING (clinic_id = current_clinic_id());

CREATE INDEX idx_notif_log_patient ON notifications_log(patient_id, created_at DESC);
CREATE INDEX idx_notif_log_status  ON notifications_log(clinic_id, status);
