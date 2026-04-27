-- RPC-функции для прямого запроса сделок из браузера без API-роута.
-- SECURITY DEFINER: обходят RLS, но фильтруют по clinic_id авторизованного пользователя.
-- Устраняют Vercel cold-start (~3-9 сек) — браузер обращается прямо к Supabase.

CREATE OR REPLACE FUNCTION get_clinic_deals(
  p_owner      text    DEFAULT 'all',
  p_show_closed boolean DEFAULT false
)
RETURNS SETOF deals
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.*
  FROM deals d
  JOIN user_profiles up ON up.id = auth.uid()
  WHERE d.clinic_id    = up.clinic_id
    AND d.deleted_at   IS NULL
    AND (p_show_closed OR d.status = 'open')
    AND (p_owner <> 'mine' OR d.responsible_user_id = auth.uid())
  ORDER BY d.stage_entered_at DESC
  LIMIT 2000
$$;

CREATE OR REPLACE FUNCTION get_clinic_deal_patients(
  p_show_closed boolean DEFAULT false
)
RETURNS TABLE (
  id         uuid,
  full_name  text,
  phones     text[],
  birth_date date,
  city       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (p.id)
    p.id, p.full_name, p.phones, p.birth_date, p.city
  FROM patients p
  JOIN deals d ON d.patient_id = p.id
  JOIN user_profiles up ON up.id = auth.uid()
  WHERE d.clinic_id  = up.clinic_id
    AND d.deleted_at IS NULL
    AND (p_show_closed OR d.status = 'open')
    AND p.deleted_at IS NULL
$$;
