-- ============================================================
-- 017_lab_templates_category.sql
-- Добавить текстовую колонку category в lab_test_templates,
-- чтобы страница /settings/lab (работающая со строковой
-- категорией) перестала падать с ошибкой schema cache.
-- ============================================================

ALTER TABLE lab_test_templates
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Если есть старые записи с category_id — подтянем имя группы
-- (только если новая колонка пустая, чтобы не затереть свежие данные).
UPDATE lab_test_templates t
   SET category = c.name
  FROM lab_categories c
 WHERE t.category_id = c.id
   AND (t.category IS NULL OR t.category = '');

-- Индекс для быстрой группировки/поиска по строковой категории
CREATE INDEX IF NOT EXISTS idx_lab_test_templates_category
  ON lab_test_templates(clinic_id, category);
