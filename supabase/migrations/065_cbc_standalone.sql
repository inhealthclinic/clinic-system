-- ============================================================
-- 065_cbc_standalone.sql
-- Добавляем «Общий анализ крови (ОАК)» как отдельную
-- самостоятельную услугу (без разбивки на показатели).
-- Не путать с панелью «ОАК+СОЭ» — там дочерние аналиты.
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
      is_lab, is_active)
    SELECT v_c, v_cat_id, 'Общий анализ крови (ОАК)', 0,
      true, true
    WHERE NOT EXISTS (
      SELECT 1 FROM services s
       WHERE s.clinic_id = v_c
         AND s.parent_service_id IS NULL
         AND LOWER(TRIM(s.name)) = 'общий анализ крови (оак)'
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
