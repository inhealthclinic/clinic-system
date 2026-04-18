-- ============================================================
-- 034_patient_portal.sql — публичный портал пациента
-- Доступ без аутентификации: ссылка вида /portal/<token>
-- плюс подтверждение даты рождения (DOB) на форме.
--
-- Архитектура:
--  • patients.portal_token UUID UNIQUE (nullable) — регенерируется по кнопке
--  • patients.portal_token_created_at — инфо для UI
--  • fn_patient_portal_lookup(token, dob)  — SECURITY DEFINER, GRANT к anon
--  • fn_patient_portal_rotate(patient_id)  — для staff, новый токен
--
-- Безопасность:
--  • RLS на patients НЕ ослабляется. Функция с SECURITY DEFINER
--    сама фильтрует по token+dob.
--  • В ответе ТОЛЬКО нужные колонки (имя, результаты). Без телефонов,
--    ИИН, адреса, финансов.
--  • Неверный DOB → пустой результат (без утечки факта существования).
-- Идемпотентно.
-- ============================================================

-- 1) Колонки в patients.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='patients' AND column_name='portal_token') THEN
    ALTER TABLE patients ADD COLUMN portal_token UUID UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='patients' AND column_name='portal_token_created_at') THEN
    ALTER TABLE patients ADD COLUMN portal_token_created_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_portal_token ON patients(portal_token) WHERE portal_token IS NOT NULL;

-- 2) Ротация токена (для staff; RLS обычный).
CREATE OR REPLACE FUNCTION fn_patient_portal_rotate(p_patient_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_new_token UUID := gen_random_uuid();
BEGIN
  UPDATE patients
     SET portal_token = v_new_token,
         portal_token_created_at = now()
   WHERE id = p_patient_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_new_token;
END
$$;

GRANT EXECUTE ON FUNCTION fn_patient_portal_rotate(UUID) TO authenticated;

-- 3) Отзыв токена (для staff).
CREATE OR REPLACE FUNCTION fn_patient_portal_revoke(p_patient_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE patients
     SET portal_token = NULL,
         portal_token_created_at = NULL
   WHERE id = p_patient_id;
END
$$;

GRANT EXECUTE ON FUNCTION fn_patient_portal_revoke(UUID) TO authenticated;

-- 4) Публичный lookup. SECURITY DEFINER — обходит RLS.
--    Возвращает JSON: { patient: {...}, results: [...] } или NULL.
CREATE OR REPLACE FUNCTION fn_patient_portal_lookup(p_token UUID, p_dob DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient patients%ROWTYPE;
  v_results JSONB;
BEGIN
  IF p_token IS NULL OR p_dob IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_patient
    FROM patients
   WHERE portal_token = p_token
     AND birth_date = p_dob
     AND deleted_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    -- Не раскрываем: неверный токен или неверная дата — одинаково NULL.
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'result_date') DESC), '[]'::jsonb)
    INTO v_results
    FROM (
      SELECT jsonb_build_object(
        'id',                    plr.id,
        'service_name',          plr.service_name_snapshot,
        'result_value',          plr.result_value,
        'result_text',           plr.result_text,
        'unit',                  plr.unit_snapshot,
        'reference_min',         plr.reference_min,
        'reference_max',         plr.reference_max,
        'reference_text',        plr.reference_text,
        'flag',                  plr.flag,
        'result_date',           plr.result_date
      ) AS r
      FROM patient_lab_results plr
      WHERE plr.patient_id = v_patient.id
      ORDER BY plr.result_date DESC
      LIMIT 500
    ) t;

  RETURN jsonb_build_object(
    'patient', jsonb_build_object(
      'full_name',      v_patient.full_name,
      'patient_number', v_patient.patient_number,
      'birth_date',     v_patient.birth_date
    ),
    'results', COALESCE(v_results, '[]'::jsonb)
  );
END
$$;

-- Анонимный доступ (через supabase anon key).
GRANT EXECUTE ON FUNCTION fn_patient_portal_lookup(UUID, DATE) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
