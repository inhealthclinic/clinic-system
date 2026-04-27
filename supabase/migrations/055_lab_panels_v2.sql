-- ============================================================
-- 055_lab_panels_v2.sql
--
-- Превращаем ОАК+СОЭ в настоящую «панель»:
--   • services.parent_service_id — ссылка услуги-аналита на
--     услугу-родительскую панель (самоссылка).
--   • Родительская услуга — это «контейнер»: is_lab=true,
--     result_type=NULL (у самой панели нет числового значения),
--     is_panel=true.
--   • Дочерние услуги — отдельные аналиты с parent_service_id=panel.id.
--
-- Переписываем seed_oak_panel(clinic): создаёт или находит
-- панель «ОАК+СОЭ», создаёт/апдейтит 25 дочерних аналитов,
-- ставит им parent_service_id. Идемпотентно.
--
-- Если в клинике ранее уже создавались 25 аналитов без parent
-- (миграция 054) — они подхватятся по имени и им проставится
-- parent_service_id. Их не пересоздаём, просто связываем.
-- ============================================================

-- ── 1) Колонки для панели ───────────────────────────────────
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS parent_service_id UUID
    REFERENCES services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_panel BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_services_parent
  ON services(parent_service_id)
  WHERE parent_service_id IS NOT NULL;

-- ── 2) Переписываем seed_oak_panel ──────────────────────────
-- Меняется return type с INT на JSONB — нужно сначала DROP.
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
  -- Категория «Гематология»
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

  -- Панель-родитель «ОАК+СОЭ»
  SELECT id INTO v_panel_id
    FROM services
   WHERE clinic_id = p_clinic_id
     AND parent_service_id IS NULL
     AND (
          LOWER(TRIM(name)) = LOWER('ОАК+СОЭ')
       OR LOWER(TRIM(name)) = LOWER('ОАК + СОЭ')
       OR LOWER(TRIM(name)) = LOWER('Клинический анализ крови + СОЭ')
     )
   LIMIT 1;

  IF v_panel_id IS NULL THEN
    INSERT INTO services (
      clinic_id, category_id, name, price,
      is_lab, is_active, is_panel
    ) VALUES (
      p_clinic_id, v_category_id, 'ОАК+СОЭ', 0,
      true, true, true
    )
    RETURNING id INTO v_panel_id;
  ELSE
    -- если нашли старую «плоскую» услугу — помечаем её как панель
    UPDATE services
       SET is_panel = true,
           category_id = COALESCE(category_id, v_category_id),
           -- у панели не должно быть числового результата
           result_type = NULL
     WHERE id = v_panel_id;
  END IF;

  -- Создаём/привязываем 25 аналитов
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC, crit_low NUMERIC, crit_high NUMERIC)
  LOOP
    -- Существует ли уже такой аналит (по имени в клинике)?
    DECLARE v_child_id UUID;
    BEGIN
      SELECT id INTO v_child_id
        FROM services
       WHERE clinic_id = p_clinic_id
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
       LIMIT 1;

      IF v_child_id IS NULL THEN
        INSERT INTO services (
          clinic_id, category_id, name, price,
          is_lab, is_active, result_type,
          default_unit, reference_min, reference_max,
          critical_low, critical_high,
          parent_service_id
        ) VALUES (
          p_clinic_id, v_category_id, v_row.name, 0,
          true, true, 'numeric',
          v_row.unit, v_row.ref_min, v_row.ref_max,
          v_row.crit_low, v_row.crit_high,
          v_panel_id
        );
        v_created := v_created + 1;
      ELSE
        -- уже есть — если нет parent, связываем с нашей панелью
        UPDATE services
           SET parent_service_id = v_panel_id,
               category_id       = COALESCE(category_id, v_category_id),
               is_lab            = true,
               result_type       = COALESCE(result_type, 'numeric'),
               default_unit      = COALESCE(default_unit, v_row.unit),
               reference_min     = COALESCE(reference_min, v_row.ref_min),
               reference_max     = COALESCE(reference_max, v_row.ref_max),
               critical_low      = COALESCE(critical_low, v_row.crit_low),
               critical_high     = COALESCE(critical_high, v_row.crit_high)
         WHERE id = v_child_id
           AND parent_service_id IS DISTINCT FROM v_panel_id;
        IF FOUND THEN
          v_linked := v_linked + 1;
        END IF;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'panel_id', v_panel_id,
    'created',  v_created,
    'linked',   v_linked
  );
END
$func$;

GRANT EXECUTE ON FUNCTION seed_oak_panel(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
