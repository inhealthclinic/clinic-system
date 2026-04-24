-- ============================================================
-- 064_dedup_services.sql
-- Удаляем дубликаты верхнеуровневых услуг (parent_service_id IS NULL)
-- в каждой клинике. Дубликат — совпадение по LOWER(TRIM(name)).
--
-- Стратегия для каждой группы:
--   1) Выбираем «каноничную» запись: с ненулевой ценой; при равных
--      ценах — самую старую (min created_at).
--   2) Остальные записи удаляем, но только если на них НЕТ ссылок
--      из других таблиц (safety). Если ссылки есть — пропускаем.
--
-- В конце — уникальный частичный индекс, чтобы такие дубли больше
-- не появлялись.
-- ============================================================

DO $$
DECLARE
  v_row    RECORD;
  v_keep   UUID;
  v_drop   UUID;
  v_refs   INT;
  v_deleted INT := 0;
BEGIN
  -- Идём по всем группам «clinic_id + lower(trim(name))»
  -- где есть >1 записи на верхнем уровне.
  FOR v_row IN
    WITH grp AS (
      SELECT clinic_id, LOWER(TRIM(name)) AS key
        FROM services
       WHERE parent_service_id IS NULL
       GROUP BY clinic_id, LOWER(TRIM(name))
      HAVING COUNT(*) > 1
    )
    SELECT g.clinic_id, g.key
      FROM grp g
  LOOP
    -- 1) каноничный: по приоритету цена > 0, затем oldest
    SELECT id INTO v_keep
      FROM services
     WHERE clinic_id = v_row.clinic_id
       AND parent_service_id IS NULL
       AND LOWER(TRIM(name)) = v_row.key
     ORDER BY (price > 0) DESC, created_at ASC
     LIMIT 1;

    -- 2) проходим по остальным
    FOR v_drop IN
      SELECT id FROM services
       WHERE clinic_id = v_row.clinic_id
         AND parent_service_id IS NULL
         AND LOWER(TRIM(name)) = v_row.key
         AND id <> v_keep
    LOOP
      -- Проверяем ссылки
      SELECT
        (SELECT COUNT(*) FROM appointments WHERE service_id = v_drop)
      + (SELECT COUNT(*) FROM lab_order_items WHERE service_id = v_drop)
      + (SELECT COUNT(*) FROM charges WHERE service_id = v_drop)
      + (SELECT COUNT(*) FROM services WHERE parent_service_id = v_drop)
      INTO v_refs;

      IF v_refs = 0 THEN
        DELETE FROM services WHERE id = v_drop;
        v_deleted := v_deleted + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Dedup: удалено % дубликатов', v_deleted;
END $$;

-- Уникальный частичный индекс — теперь SQL не даст создать дубликат
-- на верхнем уровне в рамках клиники (для is_active=true).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_services_top_name_per_clinic
  ON services (clinic_id, LOWER(TRIM(name)))
  WHERE parent_service_id IS NULL AND is_active = true;

NOTIFY pgrst, 'reload schema';
