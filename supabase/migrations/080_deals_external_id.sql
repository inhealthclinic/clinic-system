-- 080_deals_external_id.sql
-- Внешний ID сделки (из amoCRM или другой внешней системы).
-- Нужен для upsert'а при повторном импорте того же CSV: не плодим
-- дубликаты, а обновляем существующие сделки по external_id.
--
-- Никаких изменений в RLS — оставляем существующую политику
-- "deals: own clinic" (clinic_id = current_clinic_id()).

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS external_id TEXT;

COMMENT ON COLUMN deals.external_id IS
  'Внешний идентификатор сделки (например, ID из amoCRM). Используется для upsert при повторном импорте.';

-- Уникальность в рамках клиники + только для непустых значений,
-- чтобы не блокировать сделки без external_id (их может быть много).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_external_id
  ON deals(clinic_id, external_id)
  WHERE external_id IS NOT NULL;
