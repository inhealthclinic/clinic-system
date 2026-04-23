-- ============================================================
-- 056_services_sort_order.sql
-- Порядок аналитов внутри панели.
-- Добавляем services.sort_order (INT). Для ОАК+СОЭ задаём
-- фиксированный порядок как на типовом бланке анализа крови
-- (см. скриншот пользователя от 23.04.2026).
-- seed_oak_panel тоже обновляется: при создании/связывании
-- проставляем sort_order по позиции в массиве preset.
-- ============================================================

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_services_panel_sort
  ON services(parent_service_id, sort_order)
  WHERE parent_service_id IS NOT NULL;

-- ── Обновляем уже существующие дети всех панелей ОАК+СОЭ
-- (во всех клиниках) по имени → порядковый номер.
WITH ord AS (
  SELECT name, ord FROM (VALUES
    ('Гемоглобин', 1),
    ('Эритроциты', 2),
    ('Гематокрит', 3),
    ('Средний объём эритроцита (MCV)', 4),
    ('Среднее содержание Hb в эритроците (MCH)', 5),
    ('Средняя концентрация Hb в эритроците (MCHC)', 6),
    ('Распределение эритроцитов по объёму (RDW)', 7),
    ('Тромбоциты', 8),
    ('Тромбокрит', 9),
    ('Средний объём тромбоцита (MPV)', 10),
    ('Ширина распределения тромбоцитов (PDW)', 11),
    ('Доля крупных тромбоцитов', 12),
    ('Абс. кол-во крупных тромбоцитов', 13),
    ('Лейкоциты', 14),
    ('Нейтрофилы', 15),
    ('Нейтрофилы (абс. кол-во)', 16),
    ('Эозинофилы', 17),
    ('Эозинофилы (абс. кол-во)', 18),
    ('Базофилы', 19),
    ('Базофилы (абс. кол-во)', 20),
    ('Моноциты', 21),
    ('Моноциты (абс. кол-во)', 22),
    ('Лимфоциты', 23),
    ('Лимфоциты (абс. кол-во)', 24),
    ('СОЭ', 25)
  ) AS t(name, ord)
)
UPDATE services s
   SET sort_order = o.ord
  FROM ord o
  JOIN services panel
    ON panel.is_panel = true
   AND LOWER(TRIM(panel.name)) IN ('оак+соэ','оак + соэ','клинический анализ крови + соэ')
 WHERE s.parent_service_id = panel.id
   AND LOWER(TRIM(s.name)) = LOWER(TRIM(o.name));

-- ── Переписываем seed_oak_panel с поддержкой sort_order ──────
DROP FUNCTION IF EXISTS seed_oak_panel(UUID);

CREATE OR REPLACE FUNCTION seed_oak_panel(p_clinic_id UUID)
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
  v_preset CONSTANT JSONB := '[
    {"ord":1, "name":"Гемоглобин",                              "unit":"г/л",    "ref_min":120,    "ref_max":160,    "crit_low":70,  "crit_high":200},
    {"ord":2, "name":"Эритроциты",                              "unit":"×10¹²/л","ref_min":3.7,    "ref_max":5.1,    "crit_low":null,"crit_high":null},
    {"ord":3, "name":"Гематокрит",                              "unit":"%",      "ref_min":35,     "ref_max":50,     "crit_low":null,"crit_high":null},
    {"ord":4, "name":"Средний объём эритроцита (MCV)",          "unit":"фл",     "ref_min":82,     "ref_max":100,    "crit_low":null,"crit_high":null},
    {"ord":5, "name":"Среднее содержание Hb в эритроците (MCH)","unit":"пг",     "ref_min":27,     "ref_max":34,     "crit_low":null,"crit_high":null},
    {"ord":6, "name":"Средняя концентрация Hb в эритроците (MCHC)","unit":"г/л", "ref_min":316,    "ref_max":354,    "crit_low":null,"crit_high":null},
    {"ord":7, "name":"Распределение эритроцитов по объёму (RDW)","unit":"%",     "ref_min":11,     "ref_max":16,     "crit_low":null,"crit_high":null},
    {"ord":8, "name":"Тромбоциты",                              "unit":"×10⁹/л", "ref_min":125,    "ref_max":350,    "crit_low":50,  "crit_high":1000},
    {"ord":9, "name":"Тромбокрит",                              "unit":"%",      "ref_min":0.108,  "ref_max":0.282,  "crit_low":null,"crit_high":null},
    {"ord":10,"name":"Средний объём тромбоцита (MPV)",          "unit":"фл",     "ref_min":6.5,    "ref_max":12,     "crit_low":null,"crit_high":null},
    {"ord":11,"name":"Ширина распределения тромбоцитов (PDW)",  "unit":"фл",     "ref_min":10,     "ref_max":18,     "crit_low":null,"crit_high":null},
    {"ord":12,"name":"Доля крупных тромбоцитов",                "unit":"%",      "ref_min":11,     "ref_max":45,     "crit_low":null,"crit_high":null},
    {"ord":13,"name":"Абс. кол-во крупных тромбоцитов",         "unit":"×10⁹/л", "ref_min":0,      "ref_max":100,    "crit_low":null,"crit_high":null},
    {"ord":14,"name":"Лейкоциты",                               "unit":"×10⁹/л", "ref_min":3.5,    "ref_max":9.5,    "crit_low":2,   "crit_high":30},
    {"ord":15,"name":"Нейтрофилы",                              "unit":"%",      "ref_min":40,     "ref_max":75,     "crit_low":null,"crit_high":null},
    {"ord":16,"name":"Нейтрофилы (абс. кол-во)",                "unit":"×10⁹/л", "ref_min":1.8,    "ref_max":6.3,    "crit_low":0.5, "crit_high":null},
    {"ord":17,"name":"Эозинофилы",                              "unit":"%",      "ref_min":0.4,    "ref_max":8,      "crit_low":null,"crit_high":null},
    {"ord":18,"name":"Эозинофилы (абс. кол-во)",                "unit":"×10⁹/л", "ref_min":0.02,   "ref_max":0.52,   "crit_low":null,"crit_high":null},
    {"ord":19,"name":"Базофилы",                                "unit":"%",      "ref_min":0,      "ref_max":1,      "crit_low":null,"crit_high":null},
    {"ord":20,"name":"Базофилы (абс. кол-во)",                  "unit":"×10⁹/л", "ref_min":0,      "ref_max":0.06,   "crit_low":null,"crit_high":null},
    {"ord":21,"name":"Моноциты",                                "unit":"%",      "ref_min":3,      "ref_max":10,     "crit_low":null,"crit_high":null},
    {"ord":22,"name":"Моноциты (абс. кол-во)",                  "unit":"×10⁹/л", "ref_min":0.1,    "ref_max":0.6,    "crit_low":null,"crit_high":null},
    {"ord":23,"name":"Лимфоциты",                               "unit":"%",      "ref_min":20,     "ref_max":50,     "crit_low":null,"crit_high":null},
    {"ord":24,"name":"Лимфоциты (абс. кол-во)",                 "unit":"×10⁹/л", "ref_min":1.1,    "ref_max":3.2,    "crit_low":null,"crit_high":null},
    {"ord":25,"name":"СОЭ",                                     "unit":"мм/ч",   "ref_min":2,      "ref_max":15,     "crit_low":null,"crit_high":null}
  ]'::jsonb;
BEGIN
  SELECT id INTO v_category_id FROM service_categories
   WHERE clinic_id = p_clinic_id AND LOWER(name) = 'гематология' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Гематология') RETURNING id INTO v_category_id;
  END IF;

  SELECT id INTO v_panel_id FROM services
   WHERE clinic_id = p_clinic_id AND parent_service_id IS NULL
     AND (LOWER(TRIM(name)) IN ('оак+соэ','оак + соэ','клинический анализ крови + соэ'))
   LIMIT 1;
  IF v_panel_id IS NULL THEN
    INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active, is_panel)
    VALUES (p_clinic_id, v_category_id, 'ОАК+СОЭ', 0, true, true, true)
    RETURNING id INTO v_panel_id;
  ELSE
    UPDATE services SET is_panel = true,
      category_id = COALESCE(category_id, v_category_id), result_type = NULL
     WHERE id = v_panel_id;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(ord INT, name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC, crit_low NUMERIC, crit_high NUMERIC)
  LOOP
    DECLARE v_child_id UUID;
    BEGIN
      SELECT id INTO v_child_id FROM services
       WHERE clinic_id = p_clinic_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name)) LIMIT 1;

      IF v_child_id IS NULL THEN
        INSERT INTO services (clinic_id, category_id, name, price, is_lab, is_active, result_type,
          default_unit, reference_min, reference_max, critical_low, critical_high,
          parent_service_id, sort_order)
        VALUES (p_clinic_id, v_category_id, v_row.name, 0, true, true, 'numeric',
          v_row.unit, v_row.ref_min, v_row.ref_max, v_row.crit_low, v_row.crit_high,
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
               reference_max     = COALESCE(reference_max, v_row.ref_max),
               critical_low      = COALESCE(critical_low, v_row.crit_low),
               critical_high     = COALESCE(critical_high, v_row.crit_high)
         WHERE id = v_child_id
           AND (parent_service_id IS DISTINCT FROM v_panel_id OR sort_order IS DISTINCT FROM v_row.ord);
        IF FOUND THEN v_linked := v_linked + 1; END IF;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('panel_id', v_panel_id, 'created', v_created, 'linked', v_linked);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_oak_panel(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
