-- ============================================================
-- 016_lab_integration.sql
-- Интеграция услуг визита с лабораторией
-- ============================================================

-- ── Флаг "лабораторная услуга" на справочнике услуг ──────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_lab BOOLEAN NOT NULL DEFAULT false;

-- ── Флаг is_lab на услугах визита (снимок на момент записи) ─
ALTER TABLE visit_services
  ADD COLUMN IF NOT EXISTS is_lab BOOLEAN NOT NULL DEFAULT false;

-- ── Авто-разметка существующих услуг по совпадению ───────────
-- 1. По имени с lab_test_templates (точное совпадение в клинике)
UPDATE services s SET is_lab = true
WHERE s.is_lab = false
  AND EXISTS (
    SELECT 1 FROM lab_test_templates t
    WHERE LOWER(t.name) = LOWER(s.name)
      AND t.clinic_id   = s.clinic_id
      AND t.is_active   = true
  );

-- 2. По названию категории (обычные маркеры «анализы/лаборатория»)
UPDATE services s SET is_lab = true
WHERE s.is_lab = false
  AND EXISTS (
    SELECT 1 FROM service_categories c
    WHERE c.id = s.category_id
      AND (
        LOWER(c.name) LIKE '%анализ%'
        OR LOWER(c.name) LIKE '%лаборат%'
        OR LOWER(c.name) LIKE '%lab%'
      )
  );

-- ── Подтянуть is_lab в уже созданные visit_services ──────────
UPDATE visit_services vs
SET is_lab = s.is_lab
FROM services s
WHERE vs.service_id = s.id
  AND vs.is_lab IS DISTINCT FROM s.is_lab;

-- ── Индексы ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_services_is_lab
  ON services(clinic_id, is_lab) WHERE is_lab = true;

CREATE INDEX IF NOT EXISTS idx_lab_orders_visit
  ON lab_orders(visit_id);
