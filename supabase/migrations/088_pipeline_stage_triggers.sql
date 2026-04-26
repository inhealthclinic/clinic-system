-- ============================================================
-- 088_pipeline_stage_triggers.sql
--
-- Пользовательские триггеры на этапах воронки (амо-стиль).
-- В отличие от хардкодных «блоков A–G» из 085, эти добавляются
-- менеджером через UI «+ Добавить триггер» и настраиваются
-- индивидуально (текст шаблона, задержка, целевая стадия и т.п.).
--
-- Тип хранит, КОГДА триггер срабатывает (event), и ЧТО делает (action).
-- Конкретные параметры — в `config` JSONB.
--
-- Поддерживаемые типы (расширяется без миграции — это просто строка):
--   salesbot         — отправить шаблон WhatsApp (config: { template_key, delay_minutes? })
--   create_task      — создать задачу менеджеру (config: { text, due_in_minutes })
--   change_stage     — перевести в другую стадию (config: { target_stage_id, delay_minutes? })
--   change_field     — изменить колонку deals.<field> (config: { field, value, delay_minutes? })
--   change_responsible — сменить ответственного (config: { user_id, delay_minutes? })
--   edit_tags        — добавить/убрать теги (config: { add: [], remove: [], delay_minutes? })
--   send_email       — отправить письмо (config: { subject, body, to_field })
--   webhook          — POST на URL (config: { url, method, headers?, payload_template? })
--   complete_tasks   — закрыть открытые задачи сделки (config: {})
--   create_deal      — создать сделку в другой воронке (config: { pipeline_id, name_template })
--   generate_form    — сгенерировать ссылку на анкету (config: { form_id })
--   delete_files     — удалить файлы сделки (config: {})
--   businessbot      — заглушка под Businessbot (config: {})
--
-- event:
--   on_enter   — при входе в стадию (cron + сравнение entered_at + delay)
--   on_exit    — при выходе из стадии (DB-триггер на UPDATE stage_id)
--   on_create  — при создании сделки в этой стадии (DB-триггер на INSERT)
--   on_no_reply — без ответа клиента N часов (cron сравнивает last_inbound_message_at)
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_stage_triggers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  stage_id     UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  -- Что и когда
  type         TEXT NOT NULL,
  event        TEXT NOT NULL DEFAULT 'on_enter'
                 CHECK (event IN ('on_enter','on_exit','on_create','on_no_reply')),
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Управление
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  -- Метаданные
  created_by   UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pst_stage    ON pipeline_stage_triggers(stage_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pst_clinic   ON pipeline_stage_triggers(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pst_active   ON pipeline_stage_triggers(is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_pst_updated_at ON pipeline_stage_triggers;
CREATE TRIGGER trg_pst_updated_at
  BEFORE UPDATE ON pipeline_stage_triggers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE pipeline_stage_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pst_clinic ON pipeline_stage_triggers;
CREATE POLICY pst_clinic ON pipeline_stage_triggers
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

NOTIFY pgrst, 'reload schema';
