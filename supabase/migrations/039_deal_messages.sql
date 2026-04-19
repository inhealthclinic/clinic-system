-- ============================================================
-- 039_deal_messages.sql — чат внутри сделки (как в amoCRM)
--
-- deal_messages хранит переписку:
--   • direction  — in / out (кто отправитель: клиент или менеджер)
--   • channel    — internal | whatsapp | sms | telegram | call_note | email
--   • author_id  — менеджер, если исходящее
--   • body       — текст
--   • attachments — JSONB (массив {name,url,mime,size})
--
-- Пишутся в deal_events как 'message_in' / 'message_out' — для единой ленты.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  channel      TEXT NOT NULL DEFAULT 'internal'
                 CHECK (channel IN ('internal','whatsapp','sms','telegram','call_note','email')),
  author_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_id  TEXT,                          -- id в WhatsApp/SMS провайдере (для дедупликации)
  external_sender TEXT,                       -- номер/username внешнего отправителя
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_messages_deal ON deal_messages(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_messages_body_fts
  ON deal_messages USING gin (to_tsvector('simple', coalesce(body,'')));
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_messages_external
  ON deal_messages(channel, external_id) WHERE external_id IS NOT NULL;

-- Триггер: message → deal_events
CREATE OR REPLACE FUNCTION fn_deal_message_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_deal_event_insert(
    NEW.deal_id, NEW.clinic_id,
    CASE WHEN NEW.direction = 'in' THEN 'message_in' ELSE 'message_out' END,
    'deal_messages', NEW.id,
    jsonb_build_object(
      'channel', NEW.channel,
      'direction', NEW.direction,
      'preview', LEFT(NEW.body, 140),
      'has_attachments', jsonb_array_length(NEW.attachments) > 0
    )
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_deal_message_log ON deal_messages;
CREATE TRIGGER trg_deal_message_log
  AFTER INSERT ON deal_messages
  FOR EACH ROW EXECUTE FUNCTION fn_deal_message_log();

-- RLS
ALTER TABLE deal_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_messages_clinic ON deal_messages;
CREATE POLICY deal_messages_clinic ON deal_messages
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- Audit (если есть)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    DROP TRIGGER IF EXISTS audit_deal_messages ON deal_messages;
    CREATE TRIGGER audit_deal_messages AFTER INSERT OR UPDATE OR DELETE ON deal_messages
      FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
  END IF;
END $$;

-- Отметить прочитанным (helper)
CREATE OR REPLACE FUNCTION mark_deal_messages_read(p_deal_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_count INT;
BEGIN
  UPDATE deal_messages
     SET read_at = now()
   WHERE deal_id = p_deal_id
     AND direction = 'in'
     AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION mark_deal_messages_read(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
