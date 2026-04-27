-- ============================================================
-- 063_esr_standalone.sql
-- Добавляем «Скорость оседания эритроцитов» как отдельную
-- самостоятельную услугу (не путать с «СОЭ» внутри панели ОАК+СОЭ).
-- Для всех клиник.
-- ============================================================

DO $$
DECLARE
  v_c         UUID;
  v_cat_id    UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    -- Категория «Гематология», если есть; иначе NULL
    SELECT id INTO v_cat_id FROM service_categories
     WHERE clinic_id = v_c AND LOWER(name) = 'гематология' LIMIT 1;

    -- Создаём, только если ещё нет такой услуги в клинике
    INSERT INTO services (clinic_id, category_id, name, price,
      is_lab, is_active, result_type, default_unit,
      reference_min, reference_max)
    SELECT v_c, v_cat_id, 'Скорость оседания эритроцитов', 0,
      true, true, 'numeric', 'мм/ч', 2, 15
    WHERE NOT EXISTS (
      SELECT 1 FROM services s
       WHERE s.clinic_id = v_c
         AND s.parent_service_id IS NULL
         AND LOWER(TRIM(s.name)) = 'скорость оседания эритроцитов'
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
