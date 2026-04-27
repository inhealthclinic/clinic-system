-- ============================================================
-- 066_cbc_panel.sql
-- Превращаем «Общий анализ крови (ОАК)» в панель с детьми
-- (все стандартные показатели ОАК, КРОМЕ СОЭ — для СОЭ есть
-- отдельная панель «ОАК+СОЭ» и самостоятельная услуга
-- «Скорость оседания эритроцитов»).
--
-- Чтобы не конфликтовать с детьми панели «ОАК+СОЭ», имена
-- показателей суффиксируем « (ОАК)» — по аналогии с «(кал)»
-- в копрограмме.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_cbc_panel(p_clinic_id UUID)
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
    {"ord":1, "name":"Гемоглобин (ОАК)",      "unit":"г/л",        "ref_min":120, "ref_max":160},
    {"ord":2, "name":"Эритроциты (ОАК)",      "unit":"10^12/л",    "ref_min":3.8, "ref_max":5.5},
    {"ord":3, "name":"Гематокрит (ОАК)",      "unit":"%",          "ref_min":36,  "ref_max":48},
    {"ord":4, "name":"MCV (ОАК)",             "unit":"фл",         "ref_min":80,  "ref_max":100},
    {"ord":5, "name":"MCH (ОАК)",             "unit":"пг",         "ref_min":27,  "ref_max":34},
    {"ord":6, "name":"MCHC (ОАК)",            "unit":"г/л",        "ref_min":320, "ref_max":360},
    {"ord":7, "name":"RDW (ОАК)",             "unit":"%",          "ref_min":11.5,"ref_max":14.5},
    {"ord":8, "name":"Тромбоциты (ОАК)",      "unit":"10^9/л",     "ref_min":150, "ref_max":400},
    {"ord":9, "name":"MPV (ОАК)",             "unit":"фл",         "ref_min":7.4, "ref_max":10.4},
    {"ord":10,"name":"Лейкоциты (ОАК)",       "unit":"10^9/л",     "ref_min":4.0, "ref_max":9.0},
    {"ord":11,"name":"Нейтрофилы (ОАК)",      "unit":"%",          "ref_min":47,  "ref_max":72},
    {"ord":12,"name":"Лимфоциты (ОАК)",       "unit":"%",          "ref_min":19,  "ref_max":37},
    {"ord":13,"name":"Моноциты (ОАК)",        "unit":"%",          "ref_min":3,   "ref_max":11},
    {"ord":14,"name":"Эозинофилы (ОАК)",      "unit":"%",          "ref_min":0.5, "ref_max":5},
    {"ord":15,"name":"Базофилы (ОАК)",        "unit":"%",          "ref_min":0,   "ref_max":1}
  ]'::jsonb;
BEGIN
  -- Категория «Гематология»
  SELECT id INTO v_category_id FROM service_categories
   WHERE clinic_id = p_clinic_id AND LOWER(name) = 'гематология' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Гематология') RETURNING id INTO v_category_id;
  END IF;

  -- Панель-родитель ОАК (создана миграцией 065)
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
       WHERE id = v_child_id
         AND (parent_service_id IS DISTINCT FROM v_panel_id OR sort_order IS DISTINCT FROM v_row.ord);
      IF FOUND THEN v_linked := v_linked + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('panel_id', v_panel_id, 'created', v_created, 'linked', v_linked);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_cbc_panel(UUID) TO authenticated;

-- Автоматический прогон для всех клиник
DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    PERFORM seed_cbc_panel(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
