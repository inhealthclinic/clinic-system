-- ============================================================
-- 060_biochem_hormones_refs.sql
-- Референсы + единицы измерения для 31 отдельного аналита:
-- гормоны, биохимия, маркеры. Каждый — самостоятельная услуга
-- (не дочерний элемент панели).
--
-- Значения взяты из таблицы пользователя (скрин от 23.04.2026).
-- Для D-димера min=NULL, max=0.5 — потому что норма «<0,50».
--
-- Функция seed_biochem_hormones_refs(clinic_id):
--   • если услуга с таким именем уже есть — UPDATE unit/min/max
--   • если нет — INSERT (is_lab=true, result_type='numeric',
--     category_id=NULL, price=0)
-- DO-блок в конце — автопрогон для всех клиник.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_biochem_hormones_refs(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_created INT := 0;
  v_updated INT := 0;
  v_row     RECORD;
  v_id      UUID;
  v_preset CONSTANT JSONB := '[
    {"name":"ТТГ",                              "unit":"мМЕ/л",   "ref_min":0.3,   "ref_max":4.0},
    {"name":"Т3 св",                            "unit":"пмоль/л", "ref_min":2.5,   "ref_max":5.8},
    {"name":"Т4 св",                            "unit":"пмоль/л", "ref_min":10,    "ref_max":25},
    {"name":"Анти ТГ",                          "unit":"МЕ/мл",   "ref_min":0,     "ref_max":150},
    {"name":"Анти ТПО",                         "unit":"МЕ/мл",   "ref_min":0,     "ref_max":30},
    {"name":"Пролактин",                        "unit":"нг/мл",   "ref_min":4.6,   "ref_max":21.4},
    {"name":"Ферритин",                         "unit":"мкмоль/л","ref_min":15,    "ref_max":150},
    {"name":"Инсулин",                          "unit":"мкМЕ/л",  "ref_min":2,     "ref_max":29},
    {"name":"Витамин D (25-OH)",                "unit":"нг/мл",   "ref_min":30,    "ref_max":100},
    {"name":"Витамин B12",                      "unit":"пг/мл",   "ref_min":191,   "ref_max":771},
    {"name":"С-реактивный белок (СРБ)",         "unit":"мг/л",    "ref_min":3.0,   "ref_max":10.0},
    {"name":"АСЛО",                             "unit":"МЕ/мл",   "ref_min":0,     "ref_max":200},
    {"name":"Гликированный гемоглобин (HbA1c)", "unit":"%",       "ref_min":3.8,   "ref_max":5.8},
    {"name":"D-димер",                          "unit":"мг/л",    "ref_min":null,  "ref_max":0.5},
    {"name":"Общий белок",                      "unit":"г/л",     "ref_min":62,    "ref_max":85},
    {"name":"Глюкоза",                          "unit":"ммоль/л", "ref_min":3.33,  "ref_max":6.1},
    {"name":"АЛТ",                              "unit":"ед/л",    "ref_min":0,     "ref_max":40},
    {"name":"АСТ",                              "unit":"ед/л",    "ref_min":0,     "ref_max":41},
    {"name":"Билирубин общий",                  "unit":"мкмоль/л","ref_min":5,     "ref_max":21},
    {"name":"Альбумин",                         "unit":"г/л",     "ref_min":35,    "ref_max":52},
    {"name":"ГГТ",                              "unit":"мкмоль/л","ref_min":10,    "ref_max":71},
    {"name":"ЩФ",                               "unit":"ед/л",    "ref_min":40,    "ref_max":150},
    {"name":"Кальций",                          "unit":"ммоль/л", "ref_min":2.15,  "ref_max":2.55},
    {"name":"Калий",                            "unit":"ммоль/л", "ref_min":3.5,   "ref_max":5.5},
    {"name":"Железо",                           "unit":"мкмоль/л","ref_min":9,     "ref_max":30},
    {"name":"Амилаза",                          "unit":"ед/л",    "ref_min":30,    "ref_max":110},
    {"name":"Триглицериды",                     "unit":"ммоль/л", "ref_min":0.41,  "ref_max":1.86},
    {"name":"Холестерин",                       "unit":"ммоль/л", "ref_min":3.15,  "ref_max":5.18},
    {"name":"Креатинин",                        "unit":"мкмоль/л","ref_min":53,    "ref_max":124},
    {"name":"Мочевина",                         "unit":"ммоль/л", "ref_min":2.5,   "ref_max":7.5},
    {"name":"Мочевая кислота",                  "unit":"мкмоль/л","ref_min":150,   "ref_max":420}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC)
  LOOP
    -- Ищем существующую услугу того же имени (без учёта регистра и пробелов)
    SELECT id INTO v_id FROM services
     WHERE clinic_id = p_clinic_id
       AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
       AND parent_service_id IS NULL
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO services (clinic_id, name, price, is_lab, is_active, result_type,
        default_unit, reference_min, reference_max)
      VALUES (p_clinic_id, v_row.name, 0, true, true, 'numeric',
        v_row.unit, v_row.ref_min, v_row.ref_max);
      v_created := v_created + 1;
    ELSE
      UPDATE services
         SET default_unit  = v_row.unit,
             reference_min = v_row.ref_min,
             reference_max = v_row.ref_max,
             is_lab        = true,
             result_type   = COALESCE(result_type, 'numeric')
       WHERE id = v_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_biochem_hormones_refs(UUID) TO authenticated;

DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics LOOP
    PERFORM seed_biochem_hormones_refs(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
