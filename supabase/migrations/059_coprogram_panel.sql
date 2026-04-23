-- ============================================================
-- 059_coprogram_panel.sql
-- Панель «Копрограмма» — 25 показателей исследования кала.
-- Все значения текстовые (результат наблюдательный: «не обнаружено»,
-- «мягкий», «нейтральная», «в небольшом количестве» и т.п.),
-- поэтому result_type='text' + reference_text.
--
-- Имена, конфликтующие с ОАК / ОАМ (Цвет, Лейкоциты, Эритроциты),
-- уточняем суффиксом «(кал)».
-- ============================================================

CREATE OR REPLACE FUNCTION seed_coprogram_panel(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_category_id UUID;
  v_panel_id    UUID;
  v_created     INT := 0;
  v_linked      INT := 0;
  v_row         RECORD;
  v_child_id    UUID;
  v_preset CONSTANT JSONB := '[
    {"ord":1, "name":"Форма",                                 "ref_text":"Оформленный"},
    {"ord":2, "name":"Консистенция",                          "ref_text":"мягкий"},
    {"ord":3, "name":"Цвет (кал)",                            "ref_text":""},
    {"ord":4, "name":"Запах",                                 "ref_text":"каловый нерезкий"},
    {"ord":5, "name":"Реакция на кровь",                      "ref_text":"отрицательно"},
    {"ord":6, "name":"Реакция кала",                          "ref_text":"нейтральная"},
    {"ord":7, "name":"Билирубин (кал)",                       "ref_text":"не обнаружено"},
    {"ord":8, "name":"Стеркобилин",                           "ref_text":"+"},
    {"ord":9, "name":"Нейтральный жир",                       "ref_text":"не обнаружено"},
    {"ord":10,"name":"Жирные кислоты",                        "ref_text":"не обнаружено"},
    {"ord":11,"name":"Соединительная ткань",                  "ref_text":"не обнаружено"},
    {"ord":12,"name":"Мыла",                                  "ref_text":"не обнаружено"},
    {"ord":13,"name":"Мышечные волокна непереваренные",       "ref_text":"не обнаружено"},
    {"ord":14,"name":"Мышечные волокна переваренные",         "ref_text":"не обнаружено"},
    {"ord":15,"name":"Исчерченность мышечных волокон",        "ref_text":"без исчерченности"},
    {"ord":16,"name":"Переваримая клетчатка",                 "ref_text":"не обнаружено"},
    {"ord":17,"name":"Непереваримая клетчатка",               "ref_text":"в небольшом или умеренном количестве"},
    {"ord":18,"name":"Крахмальные зёрна внеклеточные",        "ref_text":"не обнаружено"},
    {"ord":19,"name":"Крахмальные зёрна внутриклеточные",     "ref_text":"не обнаружено"},
    {"ord":20,"name":"Йодофильные бактерии",                  "ref_text":"не обнаружено"},
    {"ord":21,"name":"Слизь",                                 "ref_text":"не обнаружено"},
    {"ord":22,"name":"Лейкоциты (кал)",                       "ref_text":"не обнаружено, 0-2"},
    {"ord":23,"name":"Эритроциты (кал)",                      "ref_text":"не обнаружено"},
    {"ord":24,"name":"Эпителий",                              "ref_text":"не обнаружено"},
    {"ord":25,"name":"Дрожжевой грибок",                      "ref_text":"не обнаружено"}
  ]'::jsonb;
BEGIN
  -- Категория «Общеклинические» (та же, что у ОАМ)
  SELECT id INTO v_category_id FROM service_categories
   WHERE clinic_id = p_clinic_id AND LOWER(name) = 'общеклинические' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Общеклинические') RETURNING id INTO v_category_id;
  END IF;

  -- Панель-родитель «Копрограмма»
  SELECT id INTO v_panel_id FROM services
   WHERE clinic_id = p_clinic_id
     AND parent_service_id IS NULL
     AND LOWER(TRIM(name)) IN ('копрограмма','анализ кала','кал')
   LIMIT 1;
  IF v_panel_id IS NULL THEN
    INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active, is_panel)
    VALUES (p_clinic_id, v_category_id, 'Копрограмма', 0, true, true, true)
    RETURNING id INTO v_panel_id;
  ELSE
    UPDATE services SET is_panel = true,
      category_id = COALESCE(category_id, v_category_id),
      result_type = NULL
     WHERE id = v_panel_id;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(ord INT, name TEXT, ref_text TEXT)
  LOOP
    SELECT id INTO v_child_id FROM services
     WHERE clinic_id = p_clinic_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name)) LIMIT 1;

    IF v_child_id IS NULL THEN
      INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active,
        result_type, reference_text, parent_service_id, sort_order)
      VALUES (p_clinic_id, v_category_id, v_row.name, 0, true, true,
        'text', NULLIF(v_row.ref_text, ''), v_panel_id, v_row.ord);
      v_created := v_created + 1;
    ELSE
      UPDATE services
         SET parent_service_id = v_panel_id,
             sort_order        = v_row.ord,
             category_id       = COALESCE(category_id, v_category_id),
             is_lab            = true,
             result_type       = COALESCE(result_type, 'text'),
             reference_text    = COALESCE(reference_text, NULLIF(v_row.ref_text, ''))
       WHERE id = v_child_id
         AND (parent_service_id IS DISTINCT FROM v_panel_id OR sort_order IS DISTINCT FROM v_row.ord);
      IF FOUND THEN v_linked := v_linked + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('panel_id', v_panel_id, 'created', v_created, 'linked', v_linked);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_coprogram_panel(UUID) TO authenticated;

-- Автопрогон для всех клиник
DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics LOOP
    PERFORM seed_coprogram_panel(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
