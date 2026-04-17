-- ============================================================
-- 018_user_emails_fn.sql
-- Helper RPC to resolve user_profiles.id → auth.users.email for
-- the email notification fan-out. SECURITY DEFINER so it bypasses
-- RLS on auth.users (which is tightly locked). Returns only rows
-- for users that belong to the caller's clinic.
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_emails(p_user_ids UUID[])
RETURNS TABLE (id UUID, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT up.id, u.email::TEXT
  FROM user_profiles up
  JOIN auth.users u ON u.id = up.id
  WHERE up.id = ANY(p_user_ids)
    AND up.clinic_id = current_clinic_id();
END;
$$;

REVOKE ALL ON FUNCTION get_user_emails(UUID[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_user_emails(UUID[]) TO authenticated, service_role;
