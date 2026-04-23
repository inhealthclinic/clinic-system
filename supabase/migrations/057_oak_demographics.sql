-- ============================================================
-- 057_oak_demographics.sql
-- Демографические диапазоны (мужчины/женщины) для 25 показателей
-- панели ОАК+СОЭ. Значения взяты из таблицы клиники (скрин
-- пользователя от 23.04.2026, Ref_M / Ref_F).
--
-- Создаём функцию seed_oak_demographics(clinic_id):
--   1) находит панель ОАК+СОЭ и её 25 детей по имени
--   2) для каждого — сносит предыдущие M/F диапазоны
--      (идемпотентно — повторный прогон заменит)
--   3) вставляет 2 строки reference_ranges: sex=M и sex=F
--      со значениями из пресета.
-- Потом вызываем для всех клиник.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_oak_demographics(p_clinic_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_panel_id UUID;
  v_child_id UUID;
  v_row      RECORD;
  v_inserted INT := 0;
  -- [name, unit, m_min, m_max, f_min, f_max]
  v_preset CONSTANT JSONB := '[
    ["Гемоглобин",                                 "г/л",    115,   175,   115,   140],
    ["Эритроциты",                                 "×10¹²/л",3.8,   5.8,   3.7,   5.1],
    ["Гематокрит",                                 "%",      35,    50,    35,    50],
    ["Средний объём эритроцита (MCV)",             "фл",     82,    100,   82,    100],
    ["Среднее содержание Hb в эритроците (MCH)",   "пг",     27,    34,    27,    34],
    ["Средняя концентрация Hb в эритроците (MCHC)","г/л",    316,   354,   316,   354],
    ["Распределение эритроцитов по объёму (RDW)",  "%",      11,    16,    11,    16],
    ["Тромбоциты",                                 "×10⁹/л", 125,   350,   125,   350],
    ["Тромбокрит",                                 "%",      0.108, 0.282, 0.108, 0.282],
    ["Средний объём тромбоцита (MPV)",             "фл",     6.5,   12,    6.5,   12],
    ["Ширина распределения тромбоцитов (PDW)",     "фл",     10,    18,    10,    18],
    ["Доля крупных тромбоцитов",                   "%",      11,    45,    11,    45],
    ["Абс. кол-во крупных тромбоцитов",            "×10⁹/л", 0,     100,   0,     100],
    ["Лейкоциты",                                  "×10⁹/л", 3.5,   9.5,   3.5,   9.5],
    ["Нейтрофилы",                                 "%",      40,    75,    40,    75],
    ["Нейтрофилы (абс. кол-во)",                   "×10⁹/л", 1.8,   6.3,   1.8,   6.3],
    ["Эозинофилы",                                 "%",      0.4,   8,     0.4,   8],
    ["Эозинофилы (абс. кол-во)",                   "×10⁹/л", 0.02,  0.52,  0.02,  0.52],
    ["Базофилы",                                   "%",      0,     1,     0,     1],
    ["Базофилы (абс. кол-во)",                     "×10⁹/л", 0,     0.06,  0,     0.06],
    ["Моноциты",                                   "%",      3,     10,    3,     10],
    ["Моноциты (абс. кол-во)",                     "×10⁹/л", 0.1,   0.6,   0.1,   0.6],
    ["Лимфоциты",                                  "%",      20,    50,    20,    50],
    ["Лимфоциты (абс. кол-во)",                    "×10⁹/л", 1.1,   3.2,   1.1,   3.2],
    ["СОЭ",                                        "мм/ч",   2,     15,    2,     15]
  ]'::jsonb;
BEGIN
  -- Находим панель ОАК+СОЭ в клинике
  SELECT id INTO v_panel_id FROM services
   WHERE clinic_id = p_clinic_id
     AND is_panel = true
     AND LOWER(TRIM(name)) IN ('оак+соэ','оак + соэ','клинический анализ крови + соэ')
   LIMIT 1;

  IF v_panel_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_row IN SELECT
      elem->>0 AS name,
      elem->>1 AS unit,
      (elem->>2)::NUMERIC AS m_min,
      (elem->>3)::NUMERIC AS m_max,
      (elem->>4)::NUMERIC AS f_min,
      (elem->>5)::NUMERIC AS f_max
    FROM jsonb_array_elements(v_preset) elem
  LOOP
    SELECT id INTO v_child_id FROM services
     WHERE clinic_id = p_clinic_id
       AND parent_service_id = v_panel_id
       AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
     LIMIT 1;

    IF v_child_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Сносим старые «системные» M/F диапазоны (с label 'Мужчины'/'Женщины')
    DELETE FROM reference_ranges
     WHERE service_id = v_child_id
       AND label IN ('Мужчины','Женщины');

    INSERT INTO reference_ranges (service_id, label, sex, age_min, age_max, pregnant, min_value, max_value, unit)
    VALUES
      (v_child_id, 'Мужчины', 'M', 18, NULL, NULL, v_row.m_min, v_row.m_max, v_row.unit),
      (v_child_id, 'Женщины', 'F', 18, NULL, false, v_row.f_min, v_row.f_max, v_row.unit);

    v_inserted := v_inserted + 2;
  END LOOP;

  RETURN v_inserted;
END
$func$;

GRANT EXECUTE ON FUNCTION seed_oak_demographics(UUID) TO authenticated;

-- Прогоняем сразу для всех клиник, у которых уже есть панель ОАК+СОЭ.
DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN
    SELECT DISTINCT clinic_id FROM services
     WHERE is_panel = true
       AND LOWER(TRIM(name)) IN ('оак+соэ','оак + соэ','клинический анализ крови + соэ')
  LOOP
    PERFORM seed_oak_demographics(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
