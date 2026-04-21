-- ============================================================
-- 046_unread_messages_and_realtime.sql
--
-- Цель: сделать чат в CRM-сделке «живым» и показать менеджеру,
-- что пришло новое сообщение — даже если карточка сделки закрыта.
--
-- Что делаем:
--   1) RPC fn_unread_deal_messages_for_me() — считает, сколько
--      непрочитанных ВХОДЯЩИХ (direction='in', read_at IS NULL)
--      сообщений висит на сделках, где текущий пользователь указан
--      как responsible_user_id. Ограничено current_clinic_id() и
--      не-удалёнными сделками. Используется для бейджика в сайдбаре.
--   2) Частичный индекс на deal_messages по непрочитанным входящим —
--      без него RPC будет сканировать всю таблицу.
--   3) Включаем таблицу deal_messages в publication supabase_realtime,
--      чтобы клиент мог подписаться на INSERT/UPDATE и обновлять UI
--      без F5. Делаем через DO-блок с проверкой, чтобы миграция была
--      идемпотентной: повторный прогон не упадёт на already-exists.
--
-- Колонки подтверждены по схеме:
--   • deal_messages.read_at       — TIMESTAMPTZ NULL (мигр. 039)
--   • deal_messages.direction     — TEXT 'in'|'out'  (мигр. 039)
--   • deal_messages.clinic_id     — UUID             (мигр. 039)
--   • deals.responsible_user_id   — UUID → user_profiles.id (мигр. 036)
--   • user_profiles.id            — = auth.users.id  (мигр. 001)
--   • deals.deleted_at            — TIMESTAMPTZ NULL (мигр. 036)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. RPC: количество непрочитанных входящих «на мне»
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_unread_deal_messages_for_me()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
    FROM deal_messages dm
    JOIN deals d ON d.id = dm.deal_id
   WHERE dm.direction = 'in'
     AND dm.read_at   IS NULL
     AND d.clinic_id  = current_clinic_id()
     AND d.deleted_at IS NULL
     AND d.responsible_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION fn_unread_deal_messages_for_me() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. Индекс под непрочитанные входящие
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deal_messages_unread_incoming
  ON deal_messages (clinic_id, deal_id)
  WHERE direction = 'in' AND read_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. Включить Realtime для deal_messages (если ещё не включена)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'deal_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_messages;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
