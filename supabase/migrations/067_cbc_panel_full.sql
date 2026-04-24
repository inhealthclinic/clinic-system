-- ============================================================
-- 067_cbc_panel_full.sql
-- Полный набор показателей панели «Общий анализ крови (ОАК)»
-- (24 аналита по скриншоту лаборатории, без СОЭ).
--
-- Предыдущая миграция 066 создала сокращённый набор из 15
-- показателей. Здесь: удаляем старых детей панели (только если
-- на них нет ссылок из lab_order_items/lab_results) и создаём
-- полный набор.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_cbc_panel_full(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_category_id UUID;
  v_panel_id    UUID;
  v_old         RECORD;
  v_refs        INT;
  v_deleted     INT := 0;
  v_created     INT := 0;
  v_linked      INT := 0;
  v_row         RECORD;
  v_child_id    UUID;
  v_preset CONSTANT JSONB := '[
    {"ord":1, "name":"Гемоглобин (ОАК)",                                         "unit":"г/л",      "ref_min":115,   "ref_max":140},
    {"ord":2, "name":"Эритроциты (ОАК)",                                         "unit":"×10^12/л", "ref_min":3.7,   "ref_max":5.1},
    {"ord":3, "name":"Гематокрит (ОАК)",                                         "unit":"%",        "ref_min":35,    "ref_max":50},
    {"ord":4, "name":"Средний объём эритроцита MCV (ОАК)",                       "unit":"фл",       "ref_min":82,    "ref_max":100},
    {"ord":5, "name":"Среднее содержание Hb в эритроците MCH (ОАК)",             "unit":"пг",       "ref_min":27,    "ref_max":34},
    {"ord":6, "name":"Средняя концентрация Hb в эритроците MCHC (ОАК)",          "unit":"г/л",      "ref_min":316,   "ref_max":354},
    {"ord":7, "name":"Распределение эритроцитов по объёму (ОАК)",                "unit":"%",        "ref_min":11,    "ref_max":16},
    {"ord":8, "name":"Тромбоциты (ОАК)",                                         "unit":"×10^9/л",  "ref_min":125,   "ref_max":350},
    {"ord":9, "name":"Тромбокрит (ОАК)",                                         "unit":"%",        "ref_min":0.108, "ref_max":0.282},
    {"ord":10,"name":"Средний объём тромбоцита (ОАК)",                           "unit":"фл",       "ref_min":6.5,   "ref_max":12},
    {"ord":11,"name":"Ширина распределения тромбоцитов (ОАК)",                   "unit":"фл",       "ref_min":10,    "ref_max":18},
    {"ord":12,"name":"Доля крупных тромбоцитов (ОАК)",                           "unit":"%",        "ref_min":11,    "ref_max":45},
    {"ord":13,"name":"Абс. кол-во крупных тромбоцитов (ОАК)",                    "unit":"×10^9/л",  "ref_min":0,     "ref_max":100},
    {"ord":14,"name":"Лейкоциты (ОАК)",                                          "unit":"×10^9/л",  "ref_min":3.5,   "ref_max":9.5},
    {"ord":15,"name":"Нейтрофилы (ОАК)",                                         "unit":"%",        "ref_min":40,    "ref_max":75},
    {"ord":16,"name":"Нейтрофилы абс. кол-во (ОАК)",                             "unit":"×10^9/л",  "ref_min":1.8,   "ref_max":6.3},
    {"ord":17,"name":"Эозинофилы (ОАК)",                                         "unit":"%",        "ref_min":0.4,   "ref_max":8},
    {"ord":18,"name":"Эозинофилы абс. кол-во (ОАК)",                             "unit":"×10^9/л",  "ref_min":0.02,  "ref_max":0.52},
    {"ord":19,"name":"Базофилы (ОАК)",                                           "unit":"%",        "ref_min":0,     "ref_max":1},
    {"ord":20,"name":"Базофилы абс. кол-во (ОАК)",                               "unit":"×10^9/л",  "ref_min":0,     "ref_max":0.06},
    {"ord":21,"name":"Моноциты (ОАК)",                                           "unit":"%",        "ref_min":3,     "ref_max":10},
    {"ord":22,"name":"Моноциты абс. кол-во (ОАК)",                               "unit":"×10^9/л",  "ref_min":0.1,   "ref_max":0.6},
    {"ord":23,"name":"Лимфоциты (ОАК)",                                          "unit":"%",        "ref_min":20,    "ref_max":50},
    {"ord":24,"name":"Лимфоциты абс. кол-во (ОАК)",                              "unit":"×10^9/л",  "ref_min":1.1,   "ref_max":3.2}
  ]'::jsonb;
BEGIN
  -- Категория
  SELECT id INTO v_category_id FROM service_categories
   WHERE clinic_id = p_clinic_id AND LOWER(name) = 'гематология' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Гематология') RETURNING id INTO v_category_id;
  END IF;

  -- Панель-родитель ОАК
  SELECT id INTO v_panel_id FROM services
   WHERE clinic_id = p_clinic_id
     AND parent_service_id IS NULL
     AND LOWER(TRIM(name)) = 'общий анализ крови (оак)'
   LIMIT 1;

  IF v_panel_id IS NULL THEN
    INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active, is_panel)
    VALUES (p_clinic_id, v_category_id, 'Общий анализ крови (ОАК)', 0, true, true, true)
    RETURNING id INTO v_panel_id;
  ELSE
    UPDATE services SET is_panel = true,
      category_id = COALESCE(category_id, v_category_id),
      result_type = NULL
     WHERE id = v_panel_id;
  END IF;

  -- Удаляем старых детей панели, если на них нет ссылок
  FOR v_old IN
    SELECT id, name FROM services
     WHERE clinic_id = p_clinic_id
       AND parent_service_id = v_panel_id
  LOOP
    SELECT
      (SELECT COUNT(*) FROM lab_order_items WHERE service_id = v_old.id)
    + (SELECT COUNT(*) FROM charges         WHERE service_id = v_old.id)
    + (SELECT COUNT(*) FROM appointments    WHERE service_id = v_old.id)
    INTO v_refs;

    IF v_refs = 0 THEN
      DELETE FROM reference_ranges WHERE service_id = v_old.id;
      DELETE FROM services WHERE id = v_old.id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  -- Заново создаём полный набор
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(ord INT, name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC)
  LOOP
    SELECT id INTO v_child_id FROM services
     WHERE clinic_id = p_clinic_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name)) LIMIT 1;

    IF v_child_id IS NULL THEN
      INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active,
        result_type, default_unit, reference_min, reference_max,
        parent_service_id, sort_order)
      VALUES (p_clinic_id, v_category_id, v_row.name, 0, true, true,
        'numeric', v_row.unit, v_row.ref_min, v_row.ref_max,
        v_panel_id, v_row.ord);
      v_created := v_created + 1;
    ELSE
      UPDATE services
         SET parent_service_id = v_panel_id,
             sort_order        = v_row.ord,
             category_id       = COALESCE(category_id, v_category_id),
             is_lab            = true,
             result_type       = COALESCE(result_type, 'numeric'),
             default_unit      = COALESCE(default_unit, v_row.unit),
             reference_min     = COALESCE(reference_min, v_row.ref_min),
             reference_max     = COALESCE(reference_max, v_row.ref_max)
       WHERE id = v_child_id;
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'panel_id', v_panel_id,
    'deleted',  v_deleted,
    'created',  v_created,
    'linked',   v_linked
  );
END
$func$;

GRANT EXECUTE ON FUNCTION seed_cbc_panel_full(UUID) TO authenticated;

DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    PERFORM seed_cbc_panel_full(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
