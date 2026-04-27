-- ============================================================
-- 054_seed_oak_panel.sql
--
-- Пресет «ОАК + СОЭ»: 25 показателей клинического анализа крови
-- создаются как отдельные услуги (services) категории «Гематология»
-- с корректными референсами и единицами измерения.
--
-- Используется система services + reference_ranges (мигр. 020_lis_v2).
-- Каждый показатель — самостоятельная услуга с is_lab=true,
-- result_type='numeric'. Это позволяет вносить значения по одному
-- аналиту в lab_order_items, строить историю patient_lab_results и
-- править ref-диапазоны на странице /lab/references.
--
-- Функция seed_oak_panel(clinic_uuid):
--   • идемпотентна: ON CONFLICT — ничего не трогает, если услуга
--     с таким же именем в клинике уже есть (нельзя опираться
--     на UNIQUE-индекс — его нет; проверяем через WHERE NOT EXISTS).
--   • возвращает число созданных строк.
--
-- Значения ref_min / ref_max / critical взяты из типичного бланка ОАК
-- взрослой клиники (скрин от пользователя, 23.04.2026).
-- Дети / пол / беременность — при необходимости добавляются позже
-- через /lab/references (таблица reference_ranges).
-- ============================================================

CREATE OR REPLACE FUNCTION seed_oak_panel(p_clinic_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_category_id UUID;
  v_created INT := 0;
  v_row RECORD;
  v_preset CONSTANT JSONB := '[
    {"name":"Гемоглобин",                              "unit":"г/л",    "ref_min":120,    "ref_max":160,    "crit_low":70,  "crit_high":200},
    {"name":"Эритроциты",                              "unit":"×10¹²/л","ref_min":3.7,    "ref_max":5.1,    "crit_low":null,"crit_high":null},
    {"name":"Гематокрит",                              "unit":"%",      "ref_min":35,     "ref_max":50,     "crit_low":null,"crit_high":null},
    {"name":"Средний объём эритроцита (MCV)",          "unit":"фл",     "ref_min":82,     "ref_max":100,    "crit_low":null,"crit_high":null},
    {"name":"Среднее содержание Hb в эритроците (MCH)","unit":"пг",     "ref_min":27,     "ref_max":34,     "crit_low":null,"crit_high":null},
    {"name":"Средняя концентрация Hb в эритроците (MCHC)","unit":"г/л", "ref_min":316,    "ref_max":354,    "crit_low":null,"crit_high":null},
    {"name":"Распределение эритроцитов по объёму (RDW)","unit":"%",     "ref_min":11,     "ref_max":16,     "crit_low":null,"crit_high":null},
    {"name":"Тромбоциты",                              "unit":"×10⁹/л", "ref_min":125,    "ref_max":350,    "crit_low":50,  "crit_high":1000},
    {"name":"Тромбокрит",                              "unit":"%",      "ref_min":0.108,  "ref_max":0.282,  "crit_low":null,"crit_high":null},
    {"name":"Средний объём тромбоцита (MPV)",          "unit":"фл",     "ref_min":6.5,    "ref_max":12,     "crit_low":null,"crit_high":null},
    {"name":"Ширина распределения тромбоцитов (PDW)",  "unit":"фл",     "ref_min":10,     "ref_max":18,     "crit_low":null,"crit_high":null},
    {"name":"Доля крупных тромбоцитов",                "unit":"%",      "ref_min":11,     "ref_max":45,     "crit_low":null,"crit_high":null},
    {"name":"Абс. кол-во крупных тромбоцитов",         "unit":"×10⁹/л", "ref_min":0,      "ref_max":100,    "crit_low":null,"crit_high":null},
    {"name":"Лейкоциты",                               "unit":"×10⁹/л", "ref_min":3.5,    "ref_max":9.5,    "crit_low":2,   "crit_high":30},
    {"name":"Нейтрофилы",                              "unit":"%",      "ref_min":40,     "ref_max":75,     "crit_low":null,"crit_high":null},
    {"name":"Нейтрофилы (абс. кол-во)",                "unit":"×10⁹/л", "ref_min":1.8,    "ref_max":6.3,    "crit_low":0.5, "crit_high":null},
    {"name":"Эозинофилы",                              "unit":"%",      "ref_min":0.4,    "ref_max":8,      "crit_low":null,"crit_high":null},
    {"name":"Эозинофилы (абс. кол-во)",                "unit":"×10⁹/л", "ref_min":0.02,   "ref_max":0.52,   "crit_low":null,"crit_high":null},
    {"name":"Базофилы",                                "unit":"%",      "ref_min":0,      "ref_max":1,      "crit_low":null,"crit_high":null},
    {"name":"Базофилы (абс. кол-во)",                  "unit":"×10⁹/л", "ref_min":0,      "ref_max":0.06,   "crit_low":null,"crit_high":null},
    {"name":"Моноциты",                                "unit":"%",      "ref_min":3,      "ref_max":10,     "crit_low":null,"crit_high":null},
    {"name":"Моноциты (абс. кол-во)",                  "unit":"×10⁹/л", "ref_min":0.1,    "ref_max":0.6,    "crit_low":null,"crit_high":null},
    {"name":"Лимфоциты",                               "unit":"%",      "ref_min":20,     "ref_max":50,     "crit_low":null,"crit_high":null},
    {"name":"Лимфоциты (абс. кол-во)",                 "unit":"×10⁹/л", "ref_min":1.1,    "ref_max":3.2,    "crit_low":null,"crit_high":null},
    {"name":"СОЭ",                                     "unit":"мм/ч",   "ref_min":2,      "ref_max":15,     "crit_low":null,"crit_high":null}
  ]'::jsonb;
BEGIN
  -- Гарантируем, что в клинике есть категория «Гематология».
  SELECT id INTO v_category_id
    FROM service_categories
   WHERE clinic_id = p_clinic_id
     AND LOWER(name) = 'гематология'
   LIMIT 1;

  IF v_category_id IS NULL THEN
    INSERT INTO service_categories (clinic_id, name)
    VALUES (p_clinic_id, 'Гематология')
    RETURNING id INTO v_category_id;
  END IF;

  -- Вставляем 25 показателей (только отсутствующие — сравниваем по имени).
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC, crit_low NUMERIC, crit_high NUMERIC)
  LOOP
    INSERT INTO services (
      clinic_id, category_id, name, price,
      is_lab, is_active, result_type,
      default_unit, reference_min, reference_max,
      critical_low, critical_high
    )
    SELECT
      p_clinic_id, v_category_id, v_row.name, 0,
      true, true, 'numeric',
      v_row.unit, v_row.ref_min, v_row.ref_max,
      v_row.crit_low, v_row.crit_high
    WHERE NOT EXISTS (
      SELECT 1 FROM services s
       WHERE s.clinic_id = p_clinic_id
         AND LOWER(TRIM(s.name)) = LOWER(TRIM(v_row.name))
    );

    IF FOUND THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN v_created;
END
$func$;

GRANT EXECUTE ON FUNCTION seed_oak_panel(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
