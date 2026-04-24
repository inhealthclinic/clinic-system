-- ============================================================
-- 074_lab_workstation.sql
-- Расширения для рабочего места лаборанта:
--   • services.analyzer_group   — код прибора/метода (для
--                                 группировки worklist и CSV-
--                                 экспорта в анализатор)
--   • services.sample_type      — тип пробирки по умолчанию
--   • lab_order_items.attachments JSONB — фото мазка/геля/скана
--   • seed analyzer_group для базовых услуг.
-- ============================================================

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS analyzer_group TEXT;

ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_services_analyzer_group
  ON services(clinic_id, analyzer_group)
  WHERE analyzer_group IS NOT NULL;

-- Сидируем analyzer_group по именам панелей / категорий
-- (безопасно — всегда можно переназначить вручную)
UPDATE services SET analyzer_group = 'hematology'
 WHERE analyzer_group IS NULL
   AND (LOWER(TRIM(name)) IN ('общий анализ крови (оак)', 'оак+соэ', 'оак + соэ')
        OR name LIKE '% (ОАК)' OR LOWER(TRIM(name)) = 'скорость оседания эритроцитов (соэ)');

UPDATE services SET analyzer_group = 'coagulation'
 WHERE analyzer_group IS NULL
   AND LOWER(TRIM(name)) IN (
     'ачтв','протромбиновое время','тромбиновое время','фибриноген',
     'мно','протромбин','протромбиновый индекс','длительность кровотечения',
     'свёртываемость крови','свертываемость крови','d-димер'
   );

UPDATE services SET analyzer_group = 'biochemistry'
 WHERE analyzer_group IS NULL
   AND LOWER(TRIM(name)) IN (
     'алт','аст','ггт','щф','глюкоза','холестерин','триглицериды',
     'общий белок','альбумин','амилаза','креатинин','мочевина','мочевая кислота',
     'билирубин общий','калий','кальций','железо','ферритин','гомоцистеин',
     'с-реактивный белок (срб)','асло','гликированный гемоглобин (hba1c)'
   );

UPDATE services SET analyzer_group = 'immunoassay'
 WHERE analyzer_group IS NULL
   AND LOWER(TRIM(name)) IN (
     'ттг','т3 св','т4 св','анти тг','анти тпо',
     'пролактин','кортизол','эстрадиол','прогестерон','тестостерон',
     'св. тестостерон','лг','фсг','дгэа','гспг','инсулин',
     'витамин d (25-oh)','витамин b12','b9 (фолиевая кислота)'
   );

UPDATE services SET analyzer_group = 'urinalysis'
 WHERE analyzer_group IS NULL
   AND (LOWER(TRIM(name)) IN ('общий анализ мочи (оам)','оам') OR name LIKE '% (моча)');

UPDATE services SET analyzer_group = 'coprology'
 WHERE analyzer_group IS NULL
   AND (LOWER(TRIM(name)) IN ('копрограмма','я/глисты') OR name LIKE '% (кал)');

UPDATE services SET analyzer_group = 'microscopy'
 WHERE analyzer_group IS NULL
   AND LOWER(TRIM(name)) IN (
     'микроскопия','мазок на степень чистоты','микрореакция',
     'определение группы крови','тромбоциты (ручной подсчёт)'
   );

NOTIFY pgrst, 'reload schema';
