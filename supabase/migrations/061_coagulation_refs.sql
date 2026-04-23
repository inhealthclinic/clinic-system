-- ============================================================
-- 061_coagulation_refs.sql
-- Референсы + единицы для аналитов коагулограммы.
-- АЧТВ, Протромбиновое время, Тромбиновое время, Фибриноген.
-- (МНО и Протромбиновый индекс — без референсов в источнике,
-- их только создаём как услуги, если нет; референсы пользователь
-- сможет дозаполнить позже.)
-- ============================================================

CREATE OR REPLACE FUNCTION seed_coagulation_refs(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_created INT := 0;
  v_updated INT := 0;
  v_row     RECORD;
  v_id      UUID;
  v_preset CONSTANT JSONB := '[
    {"name":"АЧТВ",                    "unit":"сек", "ref_min":26,   "ref_max":36},
    {"name":"МНО",                     "unit":null,  "ref_min":null, "ref_max":null},
    {"name":"Протромбиновое время",    "unit":"сек", "ref_min":10,   "ref_max":14},
    {"name":"Протромбиновый индекс",   "unit":"%",   "ref_min":null, "ref_max":null},
    {"name":"Тромбиновое время",       "unit":"сек", "ref_min":8,    "ref_max":14},
    {"name":"Фибриноген",              "unit":"г/л", "ref_min":2,    "ref_max":4}
  ]'::jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_preset)
    AS x(name TEXT, unit TEXT, ref_min NUMERIC, ref_max NUMERIC)
  LOOP
    SELECT id INTO v_id FROM services
     WHERE clinic_id = p_clinic_id
       AND LOWER(TRIM(name)) = LOWER(TRIM(v_row.name))
       AND parent_service_id IS NULL
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO services (clinic_id, name, price, is_lab, is_active, result_type,
        default_unit, reference_min, reference_max)
      VALUES (p_clinic_id, v_row.name, 0, true, true, 'numeric',
        v_row.unit, v_row.ref_min, v_row.ref_max);
      v_created := v_created + 1;
    ELSE
      UPDATE services
         SET default_unit  = COALESCE(v_row.unit, default_unit),
             reference_min = COALESCE(v_row.ref_min, reference_min),
             reference_max = COALESCE(v_row.ref_max, reference_max),
             is_lab        = true,
             result_type   = COALESCE(result_type, 'numeric')
       WHERE id = v_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated);
END
$func$;

GRANT EXECUTE ON FUNCTION seed_coagulation_refs(UUID) TO authenticated;

DO $$
DECLARE v_c UUID;
BEGIN
  FOR v_c IN SELECT id FROM clinics LOOP
    PERFORM seed_coagulation_refs(v_c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
