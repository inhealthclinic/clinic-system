-- ============================================================
-- 069_cbc_esr_reference_text.sql
-- Заполняем колонку «Референсы» (reference_text) для детей
-- панели «ОАК+СОЭ». Имена у детей этой панели без суффиксов,
-- поэтому матчим по clinic_id + parent_panel + LOWER(TRIM(name)).
-- ============================================================

DO $$
DECLARE
  v_c      UUID;
  v_panel  UUID;
  v_row    RECORD;
  v_map CONSTANT JSONB := '[
    {"name":"Гемоглобин",                                  "txt":"115 - 140"},
    {"name":"Эритроциты",                                  "txt":"3,7-5,1"},
    {"name":"Гематокрит",                                  "txt":"35-50"},
    {"name":"Средний объём эритроцита (MCV)",              "txt":"82-100"},
    {"name":"Средний объем эритроцита (MCV)",              "txt":"82-100"},
    {"name":"Среднее содержание Hb в эритроците (MCH)",    "txt":"27-34"},
    {"name":"Средняя концентрация Hb в эритроците (MCHC)", "txt":"316-354"},
    {"name":"Распределение эритроцитов по объёму (RDW)",   "txt":"11-16"},
    {"name":"Распределение эритроцитов по объему (RDW)",   "txt":"11-16"},
    {"name":"Тромбоциты",                                  "txt":"125-350"},
    {"name":"Тромбокрит",                                  "txt":"0,108-0,282"},
    {"name":"Средний объём тромбоцита (MPV)",              "txt":"6,5-12"},
    {"name":"Средний объем тромбоцита (MPV)",              "txt":"6,5-12"},
    {"name":"Ширина распределения тромбоцитов (PDW)",      "txt":"10-18"},
    {"name":"Доля крупных тромбоцитов",                    "txt":"11-45"},
    {"name":"Абс. кол-во крупных тромбоцитов",             "txt":"0-100"},
    {"name":"Абс.кол-во крупных тромбоцитов",              "txt":"0-100"},
    {"name":"Лейкоциты",                                   "txt":"3,5-9,5"},
    {"name":"Нейтрофилы",                                  "txt":"40-75"},
    {"name":"Нейтрофилы (абс. кол-во)",                    "txt":"1,8-6,3"},
    {"name":"Эозинофилы",                                  "txt":"0,4-8"},
    {"name":"Эозинофилы (абс. кол-во)",                    "txt":"0,02-0,52"},
    {"name":"Базофилы",                                    "txt":"0-1"},
    {"name":"Базофилы (абс. кол-во)",                      "txt":"0-0,06"},
    {"name":"Моноциты",                                    "txt":"3 - 10"},
    {"name":"Моноциты (абс. кол-во)",                      "txt":"0,1-0,6"},
    {"name":"Лимфоциты",                                   "txt":"20-50"},
    {"name":"Лимфоциты (абс. кол-во)",                     "txt":"1,1-3,2"},
    {"name":"СОЭ",                                         "txt":"2-15"},
    {"name":"Скорость оседания эритроцитов",               "txt":"2-15"}
  ]'::jsonb;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    SELECT id INTO v_panel FROM services
     WHERE clinic_id = v_c
       AND parent_service_id IS NULL
       AND (LOWER(TRIM(name)) = 'оак+соэ'
         OR LOWER(TRIM(name)) = 'оак + соэ'
         OR LOWER(TRIM(name)) LIKE 'оак%соэ')
     LIMIT 1;

    IF v_panel IS NULL THEN CONTINUE; END IF;

    FOR v_row IN SELECT * FROM jsonb_to_recordset(v_map) AS x(name TEXT, txt TEXT)
    LOOP
      UPDATE services
         SET reference_text = v_row.txt
       WHERE clinic_id = v_c
         AND parent_service_id = v_panel
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
         AND (reference_text IS NULL OR reference_text = '');
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
