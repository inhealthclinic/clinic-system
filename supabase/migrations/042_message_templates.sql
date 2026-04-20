-- ============================================================
-- 042_message_templates.sql
--
-- Шаблоны сообщений для CRM-композера (WhatsApp / чат / заметки).
-- Редактируются в /settings/message-templates, используются кнопкой
-- «Шаблоны» в карточке сделки для быстрой вставки текста.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,               -- короткое название, видно в выпадашке
  body         TEXT NOT NULL,               -- текст, вставляемый в композер
  is_favorite  BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT  NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_templates_clinic
  ON message_templates(clinic_id, sort_order);

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS — тот же паттерн, что в остальных CRM-таблицах.
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_clinic ON message_templates;
CREATE POLICY message_templates_clinic ON message_templates
  FOR ALL TO authenticated
  USING      (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- Audit (если имеется fn_audit_trigger).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_message_templates ON message_templates';
    EXECUTE 'CREATE TRIGGER trg_audit_message_templates
              AFTER INSERT OR UPDATE OR DELETE ON message_templates
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
