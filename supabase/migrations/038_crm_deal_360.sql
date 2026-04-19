-- ============================================================
-- 038_crm_deal_360.sql — «карточка сделки 360°»:
--   • доп. поля сделки (врач, тип записи, причина отказа как FK, контакт-телефон/город, комментарий)
--   • задачи сделки (deal_tasks)
--   • комментарии (deal_comments)
--   • единая хронология (deal_events) + авто-триггеры на ключевые операции
--   • защита: перевод в lost → обязательна причина отказа
--   • view v_deal_timeline — всё в одной ленте
--
-- Идемпотентно: все DDL через IF NOT EXISTS / DO-блоки.
-- ============================================================

-- 1. Доп. поля в deals --------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='preferred_doctor_id') THEN
    ALTER TABLE deals ADD COLUMN preferred_doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='appointment_type') THEN
    ALTER TABLE deals ADD COLUMN appointment_type TEXT;   -- key из /settings/schedule
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='loss_reason_id') THEN
    ALTER TABLE deals ADD COLUMN loss_reason_id UUID REFERENCES deal_loss_reasons(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='contact_phone') THEN
    ALTER TABLE deals ADD COLUMN contact_phone TEXT;      -- для «холодных» лидов без пациента
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='contact_city') THEN
    ALTER TABLE deals ADD COLUMN contact_city TEXT;
  END IF;
END $$;

-- 2. deal_tasks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  assignee_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  due_at         TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','done','cancelled')),
  completed_at   TIMESTAMPTZ,
  completed_by   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_tasks_deal     ON deal_tasks(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_tasks_clinic   ON deal_tasks(clinic_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_deal_tasks_assignee ON deal_tasks(assignee_id, status, due_at) WHERE assignee_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_deal_tasks_updated_at ON deal_tasks;
CREATE TRIGGER trg_deal_tasks_updated_at
  BEFORE UPDATE ON deal_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. deal_comments ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_comments_deal ON deal_comments(deal_id, created_at DESC);

-- 4. deal_events — единая лента хронологии ------------------------------------
-- Пишется триггерами на все связанные объекты.
CREATE TABLE IF NOT EXISTS deal_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,  -- 'deal_created'|'stage_changed'|'responsible_changed'
                              --  |'comment_added'|'task_created'|'task_done'
                              --  |'appointment_linked'|'charge_added'|'payment_added'
                              --  |'lab_order_created'|'field_changed'
  actor_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ref_table   TEXT,           -- 'appointments'|'charges'|'payments'|... (для кликабельности)
  ref_id      UUID,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_events_deal ON deal_events(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_events_kind ON deal_events(deal_id, kind, created_at DESC);

-- 5. Универсальный хелпер для вставки события --------------------------------
CREATE OR REPLACE FUNCTION fn_deal_event_insert(
  p_deal_id UUID, p_clinic_id UUID, p_kind TEXT,
  p_ref_table TEXT DEFAULT NULL, p_ref_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO deal_events(deal_id, clinic_id, kind, actor_id, ref_table, ref_id, payload)
  VALUES (p_deal_id, p_clinic_id, p_kind, auth.uid(), p_ref_table, p_ref_id, COALESCE(p_payload, '{}'::jsonb));
END
$$;

-- 6. Триггеры на deal (создание/смена ответственного/полей) -------------------
CREATE OR REPLACE FUNCTION fn_deal_log_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_from TEXT; v_to TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'deal_created', NULL, NULL,
      jsonb_build_object('name', NEW.name, 'amount', NEW.amount));
    RETURN NEW;
  END IF;

  -- стадия (дополнительно к deal_stage_history — для единой ленты)
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    SELECT name INTO v_from FROM pipeline_stages WHERE id = OLD.stage_id;
    SELECT name INTO v_to   FROM pipeline_stages WHERE id = NEW.stage_id;
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'stage_changed', 'pipeline_stages', NEW.stage_id,
      jsonb_build_object('from', v_from, 'to', v_to,
                         'from_id', OLD.stage_id, 'to_id', NEW.stage_id));
  END IF;

  -- ответственный
  IF OLD.responsible_user_id IS DISTINCT FROM NEW.responsible_user_id THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'responsible_changed',
      'user_profiles', NEW.responsible_user_id,
      jsonb_build_object('from', OLD.responsible_user_id, 'to', NEW.responsible_user_id));
  END IF;

  -- статус won/lost
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('won','lost') THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id,
      CASE WHEN NEW.status = 'won' THEN 'deal_won' ELSE 'deal_lost' END,
      NULL, NULL,
      jsonb_build_object('reason_id', NEW.loss_reason_id));
  END IF;

  -- заметные поля
  IF OLD.amount IS DISTINCT FROM NEW.amount THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'field_changed', NULL, NULL,
      jsonb_build_object('field','amount','from',OLD.amount,'to',NEW.amount));
  END IF;
  IF OLD.preferred_doctor_id IS DISTINCT FROM NEW.preferred_doctor_id THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'field_changed', 'doctors', NEW.preferred_doctor_id,
      jsonb_build_object('field','preferred_doctor_id','from',OLD.preferred_doctor_id,'to',NEW.preferred_doctor_id));
  END IF;
  IF OLD.appointment_type IS DISTINCT FROM NEW.appointment_type THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'field_changed', NULL, NULL,
      jsonb_build_object('field','appointment_type','from',OLD.appointment_type,'to',NEW.appointment_type));
  END IF;
  IF OLD.patient_id IS DISTINCT FROM NEW.patient_id THEN
    PERFORM fn_deal_event_insert(NEW.id, NEW.clinic_id, 'field_changed', 'patients', NEW.patient_id,
      jsonb_build_object('field','patient_id','from',OLD.patient_id,'to',NEW.patient_id));
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_deal_log_changes ON deals;
CREATE TRIGGER trg_deal_log_changes
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_log_changes();

-- 7. Защита: перевод в стадию с ролью 'lost' требует loss_reason_id -----------
CREATE OR REPLACE FUNCTION fn_deal_require_loss_reason()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_role TEXT;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    SELECT stage_role INTO v_role FROM pipeline_stages WHERE id = NEW.stage_id;
    IF v_role = 'lost' AND NEW.loss_reason_id IS NULL THEN
      RAISE EXCEPTION 'Loss reason required when moving deal to lost stage'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_deal_require_loss_reason ON deals;
CREATE TRIGGER trg_deal_require_loss_reason
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_require_loss_reason();

-- 8. Триггеры: события из приёмов/начислений/оплат/лаб.заказов ---------------

-- 8a. appointment → deal_events (если у приёма есть deal_id)
CREATE OR REPLACE FUNCTION fn_appointment_log_to_deal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_clinic UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN RETURN NEW; END IF;
  SELECT clinic_id INTO v_clinic FROM deals WHERE id = NEW.deal_id;
  IF v_clinic IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM fn_deal_event_insert(NEW.deal_id, v_clinic, 'appointment_linked',
      'appointments', NEW.id,
      jsonb_build_object('date', NEW.date, 'time_start', NEW.time_start, 'status', NEW.status));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM fn_deal_event_insert(NEW.deal_id, v_clinic, 'appointment_status',
      'appointments', NEW.id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_appointment_log_to_deal ON appointments;
CREATE TRIGGER trg_appointment_log_to_deal
  AFTER INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_appointment_log_to_deal();

-- 8b. charge → deal_events
CREATE OR REPLACE FUNCTION fn_charge_log_to_deal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_clinic UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN RETURN NEW; END IF;
  SELECT clinic_id INTO v_clinic FROM deals WHERE id = NEW.deal_id;
  IF v_clinic IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM fn_deal_event_insert(NEW.deal_id, v_clinic, 'charge_added',
      'charges', NEW.id,
      jsonb_build_object('total', NEW.total, 'status', NEW.status));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_charge_log_to_deal ON charges;
CREATE TRIGGER trg_charge_log_to_deal
  AFTER INSERT ON charges
  FOR EACH ROW EXECUTE FUNCTION fn_charge_log_to_deal();

-- 8c. payment → deal_events (через charge → deal)
CREATE OR REPLACE FUNCTION fn_payment_log_to_deal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_deal UUID; v_clinic UUID;
BEGIN
  IF NEW.charge_id IS NULL THEN RETURN NEW; END IF;
  SELECT c.deal_id, c.clinic_id INTO v_deal, v_clinic
    FROM charges c WHERE c.id = NEW.charge_id;
  IF v_deal IS NULL THEN RETURN NEW; END IF;

  PERFORM fn_deal_event_insert(v_deal, v_clinic, 'payment_added',
    'payments', NEW.id,
    jsonb_build_object('amount', NEW.amount, 'type', NEW.type, 'method', NEW.method));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_payment_log_to_deal ON payments;
CREATE TRIGGER trg_payment_log_to_deal
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_payment_log_to_deal();

-- 8d. lab_orders → deal_events (если визит заказа связан со сделкой через appointment)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='lab_orders') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION fn_lab_order_log_to_deal()
      RETURNS TRIGGER LANGUAGE plpgsql AS $inner$
      DECLARE v_deal UUID; v_clinic UUID;
      BEGIN
        IF NEW.visit_id IS NULL THEN RETURN NEW; END IF;
        SELECT v.deal_id, v.clinic_id INTO v_deal, v_clinic
          FROM visits v WHERE v.id = NEW.visit_id;
        IF v_deal IS NULL THEN RETURN NEW; END IF;

        PERFORM fn_deal_event_insert(v_deal, v_clinic, 'lab_order_created',
          'lab_orders', NEW.id,
          jsonb_build_object('status', NEW.status));
        RETURN NEW;
      END
      $inner$;
    $body$;
    DROP TRIGGER IF EXISTS trg_lab_order_log_to_deal ON lab_orders;
    CREATE TRIGGER trg_lab_order_log_to_deal
      AFTER INSERT ON lab_orders
      FOR EACH ROW EXECUTE FUNCTION fn_lab_order_log_to_deal();
  END IF;
END $$;

-- 9. Триггеры: deal_tasks / deal_comments → deal_events ----------------------
CREATE OR REPLACE FUNCTION fn_deal_task_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_deal_event_insert(NEW.deal_id, NEW.clinic_id, 'task_created',
      'deal_tasks', NEW.id,
      jsonb_build_object('title', NEW.title, 'due_at', NEW.due_at, 'assignee_id', NEW.assignee_id));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'done' THEN
    PERFORM fn_deal_event_insert(NEW.deal_id, NEW.clinic_id, 'task_done',
      'deal_tasks', NEW.id,
      jsonb_build_object('title', NEW.title));
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_deal_task_log ON deal_tasks;
CREATE TRIGGER trg_deal_task_log
  AFTER INSERT OR UPDATE ON deal_tasks
  FOR EACH ROW EXECUTE FUNCTION fn_deal_task_log();

CREATE OR REPLACE FUNCTION fn_deal_comment_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_deal_event_insert(NEW.deal_id, NEW.clinic_id, 'comment_added',
    'deal_comments', NEW.id,
    jsonb_build_object('preview', LEFT(NEW.body, 140)));
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_deal_comment_log ON deal_comments;
CREATE TRIGGER trg_deal_comment_log
  AFTER INSERT ON deal_comments
  FOR EACH ROW EXECUTE FUNCTION fn_deal_comment_log();

-- 10. RLS ---------------------------------------------------------------------
ALTER TABLE deal_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_tasks_clinic    ON deal_tasks;
DROP POLICY IF EXISTS deal_comments_clinic ON deal_comments;
DROP POLICY IF EXISTS deal_events_clinic   ON deal_events;

CREATE POLICY deal_tasks_clinic ON deal_tasks
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

CREATE POLICY deal_comments_clinic ON deal_comments
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

CREATE POLICY deal_events_clinic ON deal_events
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- 11. Audit (если есть общий fn_audit_trigger) -------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    DROP TRIGGER IF EXISTS audit_deal_tasks    ON deal_tasks;
    DROP TRIGGER IF EXISTS audit_deal_comments ON deal_comments;
    CREATE TRIGGER audit_deal_tasks    AFTER INSERT OR UPDATE OR DELETE ON deal_tasks
      FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
    CREATE TRIGGER audit_deal_comments AFTER INSERT OR UPDATE OR DELETE ON deal_comments
      FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
  END IF;
END $$;

-- 12. View v_deal_timeline ---------------------------------------------------
-- Единая лента: deal_events + «начальное» создание + смены стадии уже в events.
DROP VIEW IF EXISTS v_deal_timeline;
CREATE VIEW v_deal_timeline AS
SELECT
  e.id,
  e.deal_id,
  e.clinic_id,
  e.kind,
  e.actor_id,
  up.first_name || ' ' || COALESCE(up.last_name,'') AS actor_name,
  e.ref_table,
  e.ref_id,
  e.payload,
  e.created_at
FROM deal_events e
LEFT JOIN user_profiles up ON up.id = e.actor_id;

GRANT SELECT ON v_deal_timeline TO authenticated;

NOTIFY pgrst, 'reload schema';
