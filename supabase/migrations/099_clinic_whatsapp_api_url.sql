-- ============================================================
-- 099_clinic_whatsapp_api_url.sql — host для шардовых инстансов Green-API.
--
-- У free-tier инстансов (7103xxxxxx, 7105xxxxxx, 7107xxxxxx, …) API
-- живёт не на классическом https://api.green-api.com, а на шарде вида
-- https://7107.api.greenapi.com. Без этого getStateInstance возвращает 404.
-- В консоли Green-API на карточке инстанса есть строка «API URL» — её
-- значение и кладём сюда.
-- ============================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS whatsapp_api_url TEXT;

NOTIFY pgrst, 'reload schema';
