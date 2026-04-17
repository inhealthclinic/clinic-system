-- ============================================================
-- 017_whatsapp_notifications.sql
-- Полноценная WhatsApp-интеграция + in-app уведомления сотрудникам.
--
-- Что добавляет:
--   1. WHATSAPP_MESSAGES — добавляет недостающие поля для боевой
--      работы (assigned_to, contact_name, raw_payload, error_text,
--      replied_to_id, normalized_phone, индекс по deal/patient).
--   2. STAFF_NOTIFICATIONS — централизованные in-app уведомления
--      сотрудникам по событиям CRM/расписания/финансов/WA.
--   3. NOTIFICATION_PREFERENCES — двухуровневые настройки:
--        scope='clinic'  → системные правила клиники
--        scope='user'    → персональные перекрытия
--      Один тип события → одна стратегия маршрутизации.
--
-- Принцип: НЕ ломаем существующие таблицы (notifications_log /
-- notification_templates остаются для исходящих SMS/WA пациентам);
-- staff_notifications живёт параллельно для уведомлений ВНУТРИ
-- системы сотрудникам.
-- ============================================================

-- ── 1. whatsapp_messages: добавить рабочие поля ─────────────

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS assigned_to       UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS contact_name      TEXT,
  ADD COLUMN IF NOT EXISTS normalized_phone  TEXT,
  ADD COLUMN IF NOT EXISTS replied_to_id     UUID REFERENCES whatsapp_messages(id),
  ADD COLUMN IF NOT EXISTS raw_payload       JSONB,
  ADD COLUMN IF NOT EXISTS error_text        TEXT,
  ADD COLUMN IF NOT EXISTS sent_by           UUID REFERENCES user_profiles(id);

-- Полезные индексы для отображения чата по сделке/пациенту
CREATE INDEX IF NOT EXISTS idx_wa_deal_created
  ON whatsapp_messages(deal_id, created_at DESC) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_patient_created
  ON whatsapp_messages(patient_id, created_at DESC) WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_normalized_phone
  ON whatsapp_messages(normalized_phone, created_at DESC) WHERE normalized_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_assigned_unread
  ON whatsapp_messages(assigned_to, created_at DESC)
  WHERE direction = 'inbound' AND status = 'received';

-- ── 2. staff_notifications: in-app уведомления сотрудникам ──

CREATE TABLE IF NOT EXISTS staff_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Кому пришло (всегда конкретный сотрудник; для broadcast создаётся
  -- по строке на каждого).
  user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Тип события — расширяемый перечень.
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'whatsapp_new_lead',         -- лид из WA (новый незнакомый номер)
    'whatsapp_new_message',      -- входящее сообщение по существующей сделке
    'whatsapp_no_reply',         -- нет ответа > N минут (SLA-напоминание)
    'task_assigned',             -- мне назначили задачу
    'task_overdue',              -- задача просрочена
    'deal_stage_changed',        -- этап сделки изменился
    'deal_assigned',             -- мне назначили сделку
    'appointment_created',       -- создана новая запись
    'appointment_cancelled',     -- запись отменена
    'appointment_no_show',       -- пациент не явился
    'payment_received',          -- получена оплата
    'deal_won',                  -- сделка выиграна
    'lab_critical',              -- критический результат анализов
    'other'
  )),

  -- К чему относится
  entity_type TEXT CHECK (entity_type IN (
    'deal','patient','task','appointment','message','payment','lab_order','none'
  )),
  entity_id   UUID,

  -- Содержание для UI
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,                -- куда вести по клику (например /crm?deal=…)

  -- Кто/что породило
  triggered_by UUID REFERENCES user_profiles(id),  -- NULL = система

  -- Состояние
  status      TEXT NOT NULL DEFAULT 'unread'
                CHECK (status IN ('unread','read','dismissed')),
  read_at     TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_notif_user_unread
  ON staff_notifications(user_id, created_at DESC)
  WHERE status = 'unread';

CREATE INDEX IF NOT EXISTS idx_staff_notif_user_all
  ON staff_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_notif_entity
  ON staff_notifications(entity_type, entity_id);

-- ── 3. notification_preferences ────────────────────────────
-- Двухуровневые настройки: системные (scope='clinic', user_id=NULL)
-- и персональные перекрытия (scope='user', user_id=<uuid>).
-- Если строки нет — берётся дефолт из get_notification_routing().

CREATE TABLE IF NOT EXISTS notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL CHECK (scope IN ('clinic','user')),
  user_id     UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,

  -- Включено ли это событие вообще
  enabled     BOOLEAN NOT NULL DEFAULT true,

  -- Стратегия маршрутизации:
  --   'responsible'         — только ответственный по сделке/задаче
  --   'responsible_admin'   — ответственный + все админы/owner
  --   'all_role'            — все сотрудники с ролью из target_role_slugs
  --   'specific_users'      — конкретный список target_user_ids
  --   'none'                — никому (события мьютятся)
  routing     TEXT NOT NULL DEFAULT 'responsible'
                CHECK (routing IN ('responsible','responsible_admin','all_role','specific_users','none')),

  target_role_slugs TEXT[] NOT NULL DEFAULT '{}',
  target_user_ids   UUID[] NOT NULL DEFAULT '{}',

  -- Каналы — пока работает только in_app, остальные — задел.
  channels    TEXT[] NOT NULL DEFAULT '{in_app}',
                -- 'in_app' | 'email' | 'whatsapp' | 'push'

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Уникальность: одна clinic-настройка и одна user-override на тип
  CONSTRAINT pref_unique_clinic UNIQUE (clinic_id, event_type, scope, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_pref_lookup
  ON notification_preferences(clinic_id, event_type, scope);

CREATE TRIGGER trg_notif_pref_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. RLS ──────────────────────────────────────────────────
-- (current_clinic_id() уже определён в 001_core)

ALTER TABLE staff_notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences   ENABLE ROW LEVEL SECURITY;

-- staff_notifications: видишь либо свои, либо все по своей клинике
-- (для админов/owner — UI решает через has_permission()).
CREATE POLICY "staff_notif: own clinic"
  ON staff_notifications FOR ALL
  USING (clinic_id = current_clinic_id());

CREATE POLICY "notif_prefs: own clinic"
  ON notification_preferences FOR ALL
  USING (clinic_id = current_clinic_id());

-- ── 5. Хелпер: разрешить получателей уведомления ───────────
-- Возвращает user_id-ы, кому надо создать staff_notifications-строки,
-- учитывая системные настройки клиники, стратегию routing, fallback
-- на owner/admin при отсутствии responsible и персональные опт-ауты.

CREATE OR REPLACE FUNCTION resolve_notification_recipients(
  p_clinic_id   UUID,
  p_event_type  TEXT,
  p_responsible UUID
)
RETURNS TABLE (user_id UUID)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pref notification_preferences%ROWTYPE;
BEGIN
  SELECT * INTO pref
  FROM notification_preferences
  WHERE clinic_id = p_clinic_id AND scope = 'clinic' AND event_type = p_event_type
  LIMIT 1;

  IF NOT FOUND THEN
    pref.enabled := true;
    pref.routing := 'responsible';
    pref.target_role_slugs := '{}';
    pref.target_user_ids   := '{}';
  END IF;

  IF NOT pref.enabled OR pref.routing = 'none' THEN RETURN; END IF;

  RETURN QUERY
  WITH base AS (
    -- responsible
    SELECT p_responsible AS uid
    WHERE pref.routing = 'responsible' AND p_responsible IS NOT NULL

    UNION
    -- fallback owner/admin когда responsible NULL
    SELECT up.id FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE pref.routing = 'responsible'
      AND p_responsible IS NULL
      AND up.clinic_id = p_clinic_id AND up.is_active
      AND r.slug IN ('owner','admin')

    UNION
    -- responsible + admins
    SELECT up.id FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE pref.routing = 'responsible_admin'
      AND up.clinic_id = p_clinic_id AND up.is_active
      AND (up.id = p_responsible OR r.slug IN ('owner','admin'))

    UNION
    -- all_role
    SELECT up.id FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE pref.routing = 'all_role'
      AND up.clinic_id = p_clinic_id AND up.is_active
      AND r.slug = ANY(pref.target_role_slugs)

    UNION
    -- specific_users
    SELECT up.id FROM user_profiles up
    WHERE pref.routing = 'specific_users'
      AND up.clinic_id = p_clinic_id AND up.is_active
      AND up.id = ANY(pref.target_user_ids)
  )
  SELECT b.uid
  FROM base b
  WHERE b.uid IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM notification_preferences np
      WHERE np.clinic_id = p_clinic_id
        AND np.scope     = 'user'
        AND np.user_id   = b.uid
        AND np.event_type = p_event_type
        AND np.enabled   = false
    );
END;
$$;

-- ── 6. Сид дефолтных правил для всех существующих клиник ───
-- Идемпотентно: ON CONFLICT DO NOTHING.

INSERT INTO notification_preferences (clinic_id, scope, user_id, event_type, enabled, routing, channels)
SELECT c.id, 'clinic', NULL, ev, true,
       CASE
         WHEN ev IN ('whatsapp_new_lead','deal_stage_changed','deal_won','lab_critical')
           THEN 'responsible_admin'
         ELSE 'responsible'
       END,
       ARRAY['in_app']
FROM clinics c
CROSS JOIN unnest(ARRAY[
  'whatsapp_new_lead','whatsapp_new_message','whatsapp_no_reply',
  'task_assigned','task_overdue',
  'deal_stage_changed','deal_assigned','deal_won',
  'appointment_created','appointment_cancelled','appointment_no_show',
  'payment_received','lab_critical'
]) AS ev
ON CONFLICT (clinic_id, event_type, scope, user_id) DO NOTHING;
