-- ============================================================
-- 062_lab_prices.sql
-- Цены на лабораторные услуги по прайсу клиники (скрин
-- пользователя от 23.04.2026).
-- Матчим по имени (LOWER/TRIM) с запасным ILIKE-префиксом,
-- если точного совпадения нет (например, «Гликированный гемоглобин»
-- в БД хранится как «Гликированный гемоглобин (HbA1c)»).
-- Услугу не создаём, если такой ещё нет — только UPDATE существующих.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_lab_prices(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_updated INT := 0;
  v_missed  INT := 0;
  v_row     RECORD;
  v_id      UUID;
  v_preset CONSTANT JSONB := '[
    {"name":"ОАК+СОЭ",                       "price":1950},
    {"name":"ТТГ",                           "price":3050},
    {"name":"Т3 св",                         "price":3700},
    {"name":"Т4 св",                         "price":3350},
    {"name":"Анти ТГ",                       "price":3700},
    {"name":"Анти ТПО",                      "price":3700},
    {"name":"Пролактин",                     "price":3700},
    {"name":"Ферритин",                      "price":2950},
    {"name":"Общий белок",                   "price":1780},
    {"name":"Витамин D (25-OH)",             "price":8050},
    {"name":"Витамин B12",                   "price":5200},
    {"name":"С-реактивный белок (СРБ)",      "price":3460},
    {"name":"Глюкоза",                       "price":1700},
    {"name":"Гликированный гемоглобин",      "price":4100},
    {"name":"АЛТ",                           "price":1780},
    {"name":"АСТ",                           "price":1780},
    {"name":"Билирубин общий",               "price":1700},
    {"name":"Альбумин",                      "price":1780},
    {"name":"ГГТ",                           "price":1780},
    {"name":"ЩФ",                            "price":1780},
    {"name":"Кальций",                       "price":1780},
    {"name":"Калий",                         "price":1780},
    {"name":"Железо",                        "price":1780},
    {"name":"Амилаза",                       "price":1780},
    {"name":"ОАМ",                           "price":1490},
    {"name":"Триглицериды",                  "price":1780},
    {"name":"Холестерин",                    "price":1780},
    {"name":"Креатинин",                     "price":1780},
    {"name":"Мочевина",                      "price":1780},
    {"name":"Мочевая кислота",               "price":1780},
    {"name":"АСЛО",                          "price":3250},
    {"name":"Свёртываемость крови",          "price":1800},
    {"name":"Длительность кровотечения",     "price":1600},
    {"name":"Тромбоциты ручные",             "price":2000},
    {"name":"Микрореакция",                  "price":2000},
    {"name":"Я/глисты",                      "price":1800},
    {"name":"Копрограмма",                   "price":2000},
    {"name":"Мазок",                         "price":2200},
    {"name":"D-димер",                       "price":6950},
    {"name":"Коагулограмма",                 "price":4905},
    {"name":"АЧТВ",                          "price":1450},
    {"name":"Протромбиновое время",          "price":1450},
    {"name":"Тромбиновое время",             "price":1450},
    {"name":"Фибриноген",                    "price":1450},
    {"name":"Инсулин",                       "price":4850},
    {"name":"Группа крови",                  "price":1460}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(name TEXT, price NUMERIC)
  LOOP
    -- 1) точное совпадение по имени (верхнеуровневые услуги)
    SELECT id INTO v_id FROM services
     WHERE clinic_id = p_clinic_id
       AND parent_service_id IS NULL
       AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
     LIMIT 1;

    -- 2) если не нашли — префикс (Гликированный гемоглобин → ...(HbA1c))
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM services
       WHERE clinic_id = p_clinic_id
         AND parent_service_id IS NULL
         AND LOWER(TRIM(name)) LIKE LOWER(TRIM(v_row.name)) || '%'
       LIMIT 1;
    END IF;

    -- 3) «Группа крови» → возможно хранится как «Определение группы крови»
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM services
       WHERE clinic_id = p_clinic_id
         AND parent_service_id IS NULL
         AND LOWER(TRIM(name)) LIKE '%' || LOWER(TRIM(v_row.name)) || '%'
       LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
      v_missed := v_missed + 1;
      CONTINUE;
    END IF;

    UPDATE services SET price = v_row.price WHERE id = v_id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'missed', v_missed);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_lab_prices(UUID) TO authenticated;

DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics LOOP
    PERFORM seed_lab_prices(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
