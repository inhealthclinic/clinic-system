-- ============================================================
-- 093_message_templates_kind.sql
--
-- Разделяем message_templates на две роли (как в amoCRM):
--   • 'quick_reply' — шаблоны ответов оператора (кнопка «Шаблоны»
--     в композере чата сделки). Управляются в /settings/message-templates.
--   • 'salesbot'    — тексты, которые рассылает Salesbot
--     (триггеры воронки + bot_greeting/bot_followup).
--     Управляются в /settings/salesbots.
--
-- Бэкенд (sender/cron) по-прежнему читает по `key`, схема записи не меняется —
-- добавляется лишь дискриминатор для разделения списков в UI.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'quick_reply'
    CHECK (kind IN ('quick_reply', 'salesbot'));

-- Бэкфилл: всё, что использовалось как salesbot — помечаем как 'salesbot'.
--   • системные ключи bot_greeting / bot_followup_no_answer
--   • любой шаблон, на который ссылается pipeline_stage_triggers.config.template_key
UPDATE message_templates mt
   SET kind = 'salesbot'
 WHERE kind = 'quick_reply'
   AND mt.key IS NOT NULL
   AND (
     mt.key IN ('bot_greeting', 'bot_followup_no_answer')
     OR EXISTS (
       SELECT 1
         FROM pipeline_stage_triggers t
        WHERE (t.config ->> 'template_key') = mt.key
     )
   );

CREATE INDEX IF NOT EXISTS idx_message_templates_clinic_kind
  ON message_templates(clinic_id, kind, sort_order);

NOTIFY pgrst, 'reload schema';
