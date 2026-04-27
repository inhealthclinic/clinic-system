-- ============================================================
-- 071_dedup_fuzzy.sql
-- Убираем «мягкие» дубли: пары услуг верхнего уровня, чьё
-- нормализованное имя совпадает после вырезания скобок.
-- Примеры: «Витамин D» vs «Витамин D (25-OH)», «С-реактивный
-- белок» vs «С-реактивный белок (СРБ)».
--
-- Стратегия для каждой пары:
--   1) Каноничная — та, чьё имя длиннее (содержит скобочное
--      уточнение).
--   2) Если на короткую версию НЕТ ссылок — удаляем её.
--   3) Если ссылки есть — переносим их на каноничную, затем
--      удаляем.
-- ============================================================

DO $$
DECLARE
  v_grp    RECORD;
  v_keep   UUID;
  v_drop   UUID;
  v_deleted INT := 0;
BEGIN
  FOR v_grp IN
    WITH norm AS (
      SELECT
        id,
        clinic_id,
        name,
        LENGTH(name) AS nlen,
        LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(name, '\([^)]*\)', '', 'g'),
                                   '\s+', ' ', 'g'))) AS nkey
        FROM services
       WHERE parent_service_id IS NULL
         AND is_active = true
    ), grp AS (
      SELECT clinic_id, nkey
        FROM norm
       GROUP BY clinic_id, nkey
      HAVING COUNT(*) > 1
    )
    SELECT g.clinic_id, g.nkey
      FROM grp g
  LOOP
    -- Каноничная — самое длинное имя
    SELECT id INTO v_keep
      FROM services
     WHERE clinic_id = v_grp.clinic_id
       AND parent_service_id IS NULL
       AND is_active = true
       AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(name, '\([^)]*\)', '', 'g'),
                                     '\s+', ' ', 'g'))) = v_grp.nkey
     ORDER BY LENGTH(name) DESC, created_at ASC
     LIMIT 1;

    FOR v_drop IN
      SELECT id FROM services
       WHERE clinic_id = v_grp.clinic_id
         AND parent_service_id IS NULL
         AND is_active = true
         AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(name, '\([^)]*\)', '', 'g'),
                                       '\s+', ' ', 'g'))) = v_grp.nkey
         AND id <> v_keep
    LOOP
      -- Переносим возможные ссылки на каноничную
      UPDATE appointments    SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE lab_order_items SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE charges         SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE services        SET parent_service_id = v_keep
       WHERE parent_service_id = v_drop;

      -- Удаляем референс-диапазоны и саму услугу
      DELETE FROM reference_ranges WHERE service_id = v_drop;
      DELETE FROM services WHERE id = v_drop;
      v_deleted := v_deleted + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Fuzzy dedup: удалено % дубликатов', v_deleted;
END $$;

NOTIFY pgrst, 'reload schema';
