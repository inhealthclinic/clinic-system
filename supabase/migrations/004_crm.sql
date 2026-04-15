-- ============================================================
-- 004_crm.sql
-- CRM: сделки, история стадий, взаимодействия, WhatsApp
-- ============================================================

-- ============================================================
-- DEALS (сделки — 2 воронки)
-- ============================================================
CREATE TABLE deals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(id),
  -- Воронка
  funnel         TEXT NOT NULL CHECK (funnel IN ('leads','medical')),
  stage          TEXT NOT NULL,
  -- leads:   new / in_progress / contact / booked
  -- medical: booked / confirmed / arrived / in_visit / completed / follow_up / repeat
  source         TEXT CHECK (source IN ('target','referral','repeat','organic','whatsapp','instagram','other')),
  priority       TEXT NOT NULL DEFAULT 'warm'
                   CHECK (priority IN ('hot','warm','cold')),
  -- Ответственные
  first_owner_id UUID REFERENCES user_profiles(id),
  closer_id      UUID REFERENCES user_profiles(id),
  -- Потеря
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','won','lost')),
  lost_reason    TEXT CHECK (lost_reason IN ('expensive','no_time','no_answer','not_ready','other')),
  lost_notes     TEXT,
  -- SLA (вычисляются при первом interaction и при переходе в booked)
  first_response_at  TIMESTAMPTZ,
  booked_at          TIMESTAMPTZ,
  time_to_response_s INT,   -- секунд до первого ответа
  time_to_booking_s  INT,   -- секунд до записи
  -- Мета
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- DEAL STAGE HISTORY (история смен стадий)
-- ============================================================
CREATE TABLE deal_stage_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  changed_by  UUID REFERENCES user_profiles(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Автозапись истории при смене стадии
CREATE OR REPLACE FUNCTION record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO deal_stage_history(deal_id, clinic_id, from_stage, to_stage, changed_by)
    VALUES(NEW.id, NEW.clinic_id, OLD.stage, NEW.stage, auth.uid());

    -- Фиксируем SLA
    IF NEW.stage IN ('contact','in_progress') AND NEW.first_response_at IS NULL THEN
      NEW.first_response_at := now();
      NEW.time_to_response_s := EXTRACT(EPOCH FROM (now() - NEW.created_at))::INT;
    END IF;

    IF NEW.stage = 'booked' AND NEW.booked_at IS NULL THEN
      NEW.booked_at := now();
      NEW.time_to_booking_s := EXTRACT(EPOCH FROM (now() - NEW.created_at))::INT;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deal_stage_history
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();

-- ============================================================
-- CRM INTERACTIONS (звонки, сообщения, заметки)
-- ============================================================
CREATE TABLE crm_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  deal_id     UUID REFERENCES deals(id),
  patient_id  UUID REFERENCES patients(id),
  type        TEXT NOT NULL
                CHECK (type IN ('call','whatsapp','email','sms','note','visit')),
  direction   TEXT CHECK (direction IN ('inbound','outbound')),
  summary     TEXT NOT NULL,
  outcome     TEXT,
  duration_s  INT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- При первом interaction → обновить deal.first_response_at
CREATE OR REPLACE FUNCTION update_deal_first_response()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deal_id IS NOT NULL AND NEW.direction = 'outbound' THEN
    UPDATE deals SET
      first_response_at = COALESCE(first_response_at, NEW.created_at),
      time_to_response_s = COALESCE(
        time_to_response_s,
        EXTRACT(EPOCH FROM (NEW.created_at - created_at))::INT
      )
    WHERE id = NEW.deal_id AND first_response_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deal_first_response
  AFTER INSERT ON crm_interactions
  FOR EACH ROW EXECUTE FUNCTION update_deal_first_response();

-- ============================================================
-- WHATSAPP MESSAGES (входящие и исходящие)
-- ============================================================
CREATE TABLE whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  patient_id    UUID REFERENCES patients(id),
  deal_id       UUID REFERENCES deals(id),
  direction     TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_phone    TEXT NOT NULL,
  to_phone      TEXT NOT NULL,
  message       TEXT NOT NULL,
  media_url     TEXT,               -- если прислали фото/документ
  wa_message_id TEXT UNIQUE,        -- ID из WhatsApp API (дедупликация)
  status        TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','read','replied','sent','delivered','failed')),
  read_at       TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TASKS (задачи)
-- ============================================================
CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  title        TEXT NOT NULL,
  description  TEXT,
  type         TEXT CHECK (type IN (
    'call','follow_up','confirm','reminder',
    'lab_ready','lab_critical','resample',
    'control','referral','other'
  )),
  priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','in_progress','done','overdue','cancelled')),
  assigned_to  UUID REFERENCES user_profiles(id),
  created_by   UUID REFERENCES user_profiles(id),
  patient_id   UUID REFERENCES patients(id),
  deal_id      UUID REFERENCES deals(id),
  visit_id     UUID REFERENCES visits(id),
  due_at       TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ACTIVITY LOG (универсальный лог всех действий)
-- ============================================================
CREATE TABLE activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  entity_type  TEXT NOT NULL,
  -- patient/deal/appointment/visit/charge/payment
  -- lab_order/inventory/task/user/medical_record
  entity_id    UUID NOT NULL,
  action       TEXT NOT NULL,
  -- created/updated/deleted/stage_changed/status_changed
  -- signed/paid/refunded/verified/merged/approved/rejected
  user_id      UUID REFERENCES user_profiles(id),
  metadata     JSONB NOT NULL DEFAULT '{}',
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE deals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_interactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals: own clinic"              ON deals              FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "deal_stage_history: own clinic" ON deal_stage_history FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "crm_interactions: own clinic"   ON crm_interactions   FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "whatsapp_messages: own clinic"  ON whatsapp_messages  FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "tasks: own clinic"              ON tasks              FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "activity_logs: own clinic"      ON activity_logs      FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_deals_clinic_funnel  ON deals(clinic_id, funnel, stage) WHERE status = 'open';
CREATE INDEX idx_deals_patient        ON deals(patient_id);
CREATE INDEX idx_deals_assigned       ON deals(first_owner_id, status);
CREATE INDEX idx_interactions_deal    ON crm_interactions(deal_id, created_at DESC);
CREATE INDEX idx_interactions_patient ON crm_interactions(patient_id, created_at DESC);
CREATE INDEX idx_wa_phone             ON whatsapp_messages(from_phone, created_at DESC);
CREATE INDEX idx_wa_clinic            ON whatsapp_messages(clinic_id, direction, status);
CREATE INDEX idx_tasks_assigned       ON tasks(assigned_to, status, due_at);
CREATE INDEX idx_tasks_overdue        ON tasks(due_at) WHERE status IN ('new','in_progress');
CREATE INDEX idx_tasks_patient        ON tasks(patient_id) WHERE status != 'done';
CREATE INDEX idx_activity_entity      ON activity_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_activity_clinic_date ON activity_logs(clinic_id, created_at DESC);
