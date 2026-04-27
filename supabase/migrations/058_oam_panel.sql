-- ============================================================
-- 058_oam_panel.sql
-- Панель «ОАМ» (общий анализ мочи) — 12 показателей.
-- Большинство значений — текстовые («Прозрачная», «отсутствуют»,
-- «<8,5», диапазоны в виде строки), поэтому используем
-- result_type='text' + reference_text.
--
-- Функция seed_oam_panel(clinic_id) идемпотентна: панель и её
-- детей создаёт только при отсутствии, существующих связывает
-- по имени и проставляет parent_service_id + sort_order.
-- DO-блок в конце — авто-запуск для всех клиник, у которых
-- уже есть категория «Общеклинические» (или создаёт её).
-- ============================================================

CREATE OR REPLACE FUNCTION seed_oam_panel(p_clinic_id UUID)
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
    {"ord":1, "name":"Цвет",             "unit":null,          "ref_text":"Прозрачная"},
    {"ord":2, "name":"Прозрачность",     "unit":null,          "ref_text":"1010-1025"},
    {"ord":3, "name":"Удельный вес",     "unit":null,          "ref_text":"0"},
    {"ord":4, "name":"Белок",            "unit":"гр/л",        "ref_text":"5-7"},
    {"ord":5, "name":"Реакция (pH)",     "unit":null,          "ref_text":"0"},
    {"ord":6, "name":"Лейкоциты (моча)", "unit":"клетки/мкл",  "ref_text":"0"},
    {"ord":7, "name":"Эритроциты (моча)","unit":"клетки/мкл",  "ref_text":"отсутствуют"},
    {"ord":8, "name":"Кетон",            "unit":null,          "ref_text":"1,70-30"},
    {"ord":9, "name":"Уробилиноген",     "unit":null,          "ref_text":"<8,5"},
    {"ord":10,"name":"Билирубин (моча)", "unit":null,          "ref_text":"<2,80"},
    {"ord":11,"name":"Глюкоза в моче",   "unit":null,          "ref_text":"отсутствуют"},
    {"ord":12,"name":"Нитриты",          "unit":null,          "ref_text":"отсутствуют"}
  ]'::jsonb;
BEGIN
  -- Категория «Общеклинические»
  SELECT id INTO v_category_id FROM service_categories
   WHERE clinic_id = p_clinic_id AND LOWER(name) = 'общеклинические' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Общеклинические') RETURNING id INTO v_category_id;
  END IF;

  -- Панель-родитель ОАМ
  SELECT id INTO v_panel_id FROM services
   WHERE clinic_id = p_clinic_id
     AND parent_service_id IS NULL
     AND LOWER(TRIM(name)) IN ('оам','общий анализ мочи')
   LIMIT 1;
  IF v_panel_id IS NULL THEN
    INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active, is_panel)
    VALUES (p_clinic_id, v_category_id, 'ОАМ', 0, true, true, true)
    RETURNING id INTO v_panel_id;
  ELSE
    UPDATE services SET is_panel = true,
      category_id = COALESCE(category_id, v_category_id),
      result_type = NULL
     WHERE id = v_panel_id;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(ord INT, name TEXT, unit TEXT, ref_text TEXT)
  LOOP
    SELECT id INTO v_child_id FROM services
     WHERE clinic_id = p_clinic_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name)) LIMIT 1;

    IF v_child_id IS NULL THEN
      INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active,
        result_type, default_unit, reference_text,
        parent_service_id, sort_order)
      VALUES (p_clinic_id, v_category_id, v_row.name, 0, true, true,
        'text', v_row.unit, v_row.ref_text,
        v_panel_id, v_row.ord);
      v_created := v_created + 1;
    ELSE
      UPDATE services
         SET parent_service_id = v_panel_id,
             sort_order        = v_row.ord,
             category_id       = COALESCE(category_id, v_category_id),
             is_lab            = true,
             result_type       = COALESCE(result_type, 'text'),
             default_unit      = COALESCE(default_unit, v_row.unit),
             reference_text    = COALESCE(reference_text, v_row.ref_text)
       WHERE id = v_child_id
         AND (parent_service_id IS DISTINCT FROM v_panel_id OR sort_order IS DISTINCT FROM v_row.ord);
      IF FOUND THEN v_linked := v_linked + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('panel_id', v_panel_id, 'created', v_created, 'linked', v_linked);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_oam_panel(UUID) TO authenticated;

-- Автоматический прогон для всех клиник
DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    PERFORM seed_oam_panel(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
