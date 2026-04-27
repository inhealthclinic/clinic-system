-- ============================================================
-- 070_cbc_sex_ranges.sql
-- Заполняем половые референсы (M/F) для детей панели
-- «Общий анализ крови (ОАК)». Для показателей, где разницы нет,
-- копируем те же значения в обе группы — чтобы на вкладках
-- «Мужчины» / «Женщины» пустые ячейки не пугали.
--
-- Идемпотентно: DELETE + INSERT на каждую пару (service_id, sex).
-- ============================================================

DO $$
DECLARE
  v_c      UUID;
  v_panel  UUID;
  v_row    RECORD;
  v_sid    UUID;
  v_map CONSTANT JSONB := '[
    {"name":"Гемоглобин (ОАК)",                                 "m_min":130,  "m_max":170,  "f_min":115,  "f_max":140},
    {"name":"Эритроциты (ОАК)",                                 "m_min":4.3,  "m_max":5.7,  "f_min":3.7,  "f_max":5.1},
    {"name":"Гематокрит (ОАК)",                                 "m_min":40,   "m_max":48,   "f_min":35,   "f_max":45},
    {"name":"Средний объём эритроцита MCV (ОАК)",               "m_min":82,   "m_max":100,  "f_min":82,   "f_max":100},
    {"name":"Среднее содержание Hb в эритроците MCH (ОАК)",     "m_min":27,   "m_max":34,   "f_min":27,   "f_max":34},
    {"name":"Средняя концентрация Hb в эритроците MCHC (ОАК)",  "m_min":316,  "m_max":354,  "f_min":316,  "f_max":354},
    {"name":"Распределение эритроцитов по объёму (ОАК)",        "m_min":11,   "m_max":16,   "f_min":11,   "f_max":16},
    {"name":"Тромбоциты (ОАК)",                                 "m_min":125,  "m_max":350,  "f_min":125,  "f_max":350},
    {"name":"Тромбокрит (ОАК)",                                 "m_min":0.108,"m_max":0.282,"f_min":0.108,"f_max":0.282},
    {"name":"Средний объём тромбоцита (ОАК)",                   "m_min":6.5,  "m_max":12,   "f_min":6.5,  "f_max":12},
    {"name":"Ширина распределения тромбоцитов (ОАК)",           "m_min":10,   "m_max":18,   "f_min":10,   "f_max":18},
    {"name":"Доля крупных тромбоцитов (ОАК)",                   "m_min":11,   "m_max":45,   "f_min":11,   "f_max":45},
    {"name":"Абс. кол-во крупных тромбоцитов (ОАК)",            "m_min":0,    "m_max":100,  "f_min":0,    "f_max":100},
    {"name":"Лейкоциты (ОАК)",                                  "m_min":3.5,  "m_max":9.5,  "f_min":3.5,  "f_max":9.5},
    {"name":"Нейтрофилы (ОАК)",                                 "m_min":40,   "m_max":75,   "f_min":40,   "f_max":75},
    {"name":"Нейтрофилы абс. кол-во (ОАК)",                     "m_min":1.8,  "m_max":6.3,  "f_min":1.8,  "f_max":6.3},
    {"name":"Эозинофилы (ОАК)",                                 "m_min":0.4,  "m_max":8,    "f_min":0.4,  "f_max":8},
    {"name":"Эозинофилы абс. кол-во (ОАК)",                     "m_min":0.02, "m_max":0.52, "f_min":0.02, "f_max":0.52},
    {"name":"Базофилы (ОАК)",                                   "m_min":0,    "m_max":1,    "f_min":0,    "f_max":1},
    {"name":"Базофилы абс. кол-во (ОАК)",                       "m_min":0,    "m_max":0.06, "f_min":0,    "f_max":0.06},
    {"name":"Моноциты (ОАК)",                                   "m_min":3,    "m_max":10,   "f_min":3,    "f_max":10},
    {"name":"Моноциты абс. кол-во (ОАК)",                       "m_min":0.1,  "m_max":0.6,  "f_min":0.1,  "f_max":0.6},
    {"name":"Лимфоциты (ОАК)",                                  "m_min":20,   "m_max":50,   "f_min":20,   "f_max":50},
    {"name":"Лимфоциты абс. кол-во (ОАК)",                      "m_min":1.1,  "m_max":3.2,  "f_min":1.1,  "f_max":3.2}
  ]'::jsonb;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    SELECT id INTO v_panel FROM services
     WHERE clinic_id = v_c
       AND parent_service_id IS NULL
       AND LOWER(TRIM(name)) = 'общий анализ крови (оак)'
     LIMIT 1;

    IF v_panel IS NULL THEN CONTINUE; END IF;

    FOR v_row IN SELECT * FROM jsonb_to_recordset(v_map)
      AS x(name TEXT, m_min NUMERIC, m_max NUMERIC, f_min NUMERIC, f_max NUMERIC)
    LOOP
      SELECT id INTO v_sid FROM services
       WHERE clinic_id = v_c
         AND parent_service_id = v_panel
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
       LIMIT 1;

      IF v_sid IS NULL THEN CONTINUE; END IF;

      DELETE FROM reference_ranges
       WHERE service_id = v_sid
         AND sex IN ('M','F')
         AND age_min IS NULL AND age_max IS NULL;

      INSERT INTO reference_ranges (service_id, sex, min_value, max_value)
      VALUES
        (v_sid, 'M', v_row.m_min, v_row.m_max),
        (v_sid, 'F', v_row.f_min, v_row.f_max);
    END LOOP;
  END LOOP;
END $$;

-- Дублируем для панели «ОАК+СОЭ» (имена детей без суффикса)
DO $$
DECLARE
  v_c      UUID;
  v_panel  UUID;
  v_row    RECORD;
  v_sid    UUID;
  v_map CONSTANT JSONB := '[
    {"n":"Гемоглобин",                                    "m_min":130,  "m_max":170,  "f_min":115,  "f_max":140},
    {"n":"Эритроциты",                                    "m_min":4.3,  "m_max":5.7,  "f_min":3.7,  "f_max":5.1},
    {"n":"Гематокрит",                                    "m_min":40,   "m_max":48,   "f_min":35,   "f_max":45}
  ]'::jsonb;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    SELECT id INTO v_panel FROM services
     WHERE clinic_id = v_c
       AND parent_service_id IS NULL
       AND LOWER(TRIM(name)) LIKE 'оак%соэ'
     LIMIT 1;

    IF v_panel IS NULL THEN CONTINUE; END IF;

    FOR v_row IN SELECT * FROM jsonb_to_recordset(v_map)
      AS x(n TEXT, m_min NUMERIC, m_max NUMERIC, f_min NUMERIC, f_max NUMERIC)
    LOOP
      SELECT id INTO v_sid FROM services
       WHERE clinic_id = v_c
         AND parent_service_id = v_panel
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.n))
       LIMIT 1;

      IF v_sid IS NULL THEN CONTINUE; END IF;

      DELETE FROM reference_ranges
       WHERE service_id = v_sid
         AND sex IN ('M','F')
         AND age_min IS NULL AND age_max IS NULL;

      INSERT INTO reference_ranges (service_id, sex, min_value, max_value)
      VALUES
        (v_sid, 'M', v_row.m_min, v_row.m_max),
        (v_sid, 'F', v_row.f_min, v_row.f_max);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
