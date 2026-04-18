-- ============================================================
-- 022_reference_ranges_ext.sql — расширение reference_ranges
-- Добавляет pregnant, unit, label для демографически-специфичных
-- референсов (дети / женщины / мужчины / беременные).
-- Идемпотентно.
-- ============================================================

ALTER TABLE reference_ranges
  ADD COLUMN IF NOT EXISTS pregnant BOOLEAN,         -- NULL = любой, true = только беременные, false = только не беременные
  ADD COLUMN IF NOT EXISTS unit     TEXT,            -- переопределение единиц измерения для группы
  ADD COLUMN IF NOT EXISTS label    TEXT;            -- человекочитаемое название ("Дети до 12 лет", "Беременные II-III триместр")

CREATE INDEX IF NOT EXISTS idx_reference_ranges_demo
  ON reference_ranges(service_id, sex, pregnant);
