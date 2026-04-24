-- ============================================================
-- 073_dedup_variants_v2.sql
-- Повторная попытка миграции 072: добавили перенос ссылок
-- из service_package_items и других таблиц, которые не были
-- учтены в 072.
-- ============================================================

DO $$
DECLARE
  v_keep  UUID;
  v_drop  UUID;
  v_c     UUID;
  v_pair  RECORD;
  v_pairs CONSTANT JSONB := '[
    {"keep":"Анти ТГ",                           "drop":"Анти-ТГ"},
    {"keep":"Анти ТПО",                          "drop":"Анти-ТПО"},
    {"keep":"АСЛО",                              "drop":"АСЛ-О"},
    {"keep":"Билирубин общий",                   "drop":"Билирубин общ"},
    {"keep":"Гликированный гемоглобин (HbA1c)",  "drop":"Гликиров. гемоглобин"},
    {"keep":"Т3 св",                             "drop":"Т3 свободный"},
    {"keep":"Т4 св",                             "drop":"Т4 свободный"},
    {"keep":"Холестерин",                        "drop":"Холестерин общ"},
    {"keep":"ЩФ",                                "drop":"Щелочная фосфатаза"}
  ]'::jsonb;
BEGIN
  FOR v_c IN SELECT id FROM clinics
  LOOP
    FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_pairs) AS x(keep TEXT, drop TEXT)
    LOOP
      SELECT id INTO v_keep FROM services
       WHERE clinic_id = v_c AND parent_service_id IS NULL
         AND is_active = true
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_pair.keep)) LIMIT 1;

      SELECT id INTO v_drop FROM services
       WHERE clinic_id = v_c AND parent_service_id IS NULL
         AND is_active = true
         AND LOWER(TRIM(name)) = LOWER(TRIM(v_pair.drop)) LIMIT 1;

      IF v_keep IS NULL OR v_drop IS NULL THEN CONTINUE; END IF;

      -- Переносим все возможные ссылки на каноничную
      UPDATE appointments            SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE lab_order_items         SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE charges                 SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE services                SET parent_service_id = v_keep WHERE parent_service_id = v_drop;

      -- service_package_items: если у keep уже есть запись в том же пакете,
      -- просто удаляем дублирующую. Иначе переносим.
      DELETE FROM service_package_items spi1
       WHERE spi1.service_id = v_drop
         AND EXISTS (
           SELECT 1 FROM service_package_items spi2
            WHERE spi2.package_id = spi1.package_id
              AND spi2.service_id = v_keep
         );
      UPDATE service_package_items   SET service_id = v_keep WHERE service_id = v_drop;

      -- Прочие таблицы-ссылочники
      BEGIN
        EXECUTE 'UPDATE visit_services SET service_id = $1 WHERE service_id = $2' USING v_keep, v_drop;
      EXCEPTION WHEN undefined_table THEN NULL; END;

      BEGIN
        EXECUTE 'UPDATE lab_orders SET service_id = $1 WHERE service_id = $2' USING v_keep, v_drop;
      EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

      BEGIN
        EXECUTE 'UPDATE patient_lab_results SET service_id = $1 WHERE service_id = $2' USING v_keep, v_drop;
      EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

      BEGIN
        EXECUTE 'UPDATE panel_members SET member_service_id = $1 WHERE member_service_id = $2' USING v_keep, v_drop;
      EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

      DELETE FROM reference_ranges WHERE service_id = v_drop;
      DELETE FROM services WHERE id = v_drop;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
