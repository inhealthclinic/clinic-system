-- ============================================================
-- 040_deal_message_status.sql — статус отправки WhatsApp-сообщений
--   • pending  — локально сохранено, GreenAPI ещё не отдал idMessage
--   • sent     — отдано GreenAPI, idMessage получен
--   • delivered— доставлено устройству клиента (statusMessage 'delivered')
--   • read     — прочитано клиентом ('read')
--   • failed   — ошибка отправки (error_text)
-- Webhook outgoingMessageStatus обновляет строку по external_id.
-- ============================================================

ALTER TABLE deal_messages
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('pending','sent','delivered','read','failed')),
  ADD COLUMN IF NOT EXISTS error_text TEXT;

-- Индекс для быстрого matching по external_id при обновлении статуса
CREATE INDEX IF NOT EXISTS idx_deal_messages_status
  ON deal_messages(status, created_at DESC)
  WHERE status IN ('pending','failed');

NOTIFY pgrst, 'reload schema';
