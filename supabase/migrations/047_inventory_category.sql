-- ============================================================
-- 047_inventory_category.sql
-- Категория (группа оборудования / направления) для реагентов
-- и расходников. Примеры: ИФА, Биохимия, Коагулограмма,
-- Гематология, Экспресс, Общий анализ мочи.
-- ============================================================

ALTER TABLE reagents    ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE consumables ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_reagents_category    ON reagents    (clinic_id, category);
CREATE INDEX IF NOT EXISTS idx_consumables_category ON consumables (clinic_id, category);
