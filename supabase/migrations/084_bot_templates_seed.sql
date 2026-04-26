-- ─────────────────────────────────────────────────────────────────────────────
-- 084_bot_templates_seed.sql
--
-- Сидим два системных шаблона приветственного бота для каждой существующей
-- клиники. Идемпотентно: если для клиники уже есть запись с таким key —
-- не трогаем (NOT EXISTS, не ON CONFLICT — partial unique index плохо
-- сочетается с ON CONFLICT без явного WHERE-clause в target).
--
-- Тексты — дословный перевод сценария из amoCRM Salesbot. Менеджер может
-- отредактировать body через UI /settings/clinic, key/title не трогает.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO message_templates (clinic_id, title, body, key, sort_order, is_active)
SELECT
  c.id,
  'Бот: приветствие',
  'Здравствуйте! Спасибо, что обратились. Я — Камилла, ассистент клиники IN HEALTH. Чем могу помочь?',
  'bot_greeting',
  100,
  true
FROM clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates t
  WHERE t.clinic_id = c.id AND t.key = 'bot_greeting'
);

INSERT INTO message_templates (clinic_id, title, body, key, sort_order, is_active)
SELECT
  c.id,
  'Бот: фоллоуап без ответа',
  'Я отметила Ваш запрос. Скоро администратор клиники свяжется с Вами для уточнения деталей.',
  'bot_followup_no_answer',
  101,
  true
FROM clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM message_templates t
  WHERE t.clinic_id = c.id AND t.key = 'bot_followup_no_answer'
);
