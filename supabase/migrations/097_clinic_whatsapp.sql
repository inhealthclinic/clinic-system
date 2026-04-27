-- ============================================================
-- 097_clinic_whatsapp.sql — храним креды Green-API в clinics.
--
-- Раньше idInstance/apiToken/webhookToken задавались только через env-vars
-- деплоя. Это требует редеплоя при смене номера, и UI-настройки не работают.
-- Теперь храним в БД (per-clinic) с приоритетом над env (env остаётся
-- запасным значением для обратной совместимости).
--
-- Доступ к колонкам — только service-role (читаем/пишем из API-роутов
-- через admin client, RLS не выпускает токены клиенту).
-- ============================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS whatsapp_instance_id   TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_api_token     TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_webhook_token TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_api_url       TEXT;

-- Поиск клиники по webhook-токену (мульти-тенант webhook).
CREATE INDEX IF NOT EXISTS idx_clinics_whatsapp_webhook_token
  ON clinics(whatsapp_webhook_token)
  WHERE whatsapp_webhook_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
