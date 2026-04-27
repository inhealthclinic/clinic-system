-- ============================================================
-- 072_dedup_variants.sql
-- Удаляем дубли с разным написанием (дефисы, сокращения).
-- Все пары проверены вручную. FK-ссылки переносятся на
-- каноничную версию перед удалением.
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

      UPDATE appointments    SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE lab_order_items SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE charges         SET service_id = v_keep WHERE service_id = v_drop;
      UPDATE services        SET parent_service_id = v_keep WHERE parent_service_id = v_drop;

      DELETE FROM reference_ranges WHERE service_id = v_drop;
      DELETE FROM services WHERE id = v_drop;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
