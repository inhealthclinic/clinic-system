-- ============================================================
-- 024_audit_logs.sql
-- Centralized audit log, captured via DB triggers (cannot be bypassed
-- from the application layer). Logs INSERT/UPDATE/DELETE on core
-- clinical + financial tables with user attribution + severity.
-- Idempotent: safe to re-run.
-- ============================================================

-- ─── Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  clinic_id      UUID,
  user_id        UUID,
  user_name      TEXT,
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  old_value      JSONB,
  new_value      JSONB,
  changed_fields TEXT[],
  severity       TEXT DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  ip_address     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_created
  ON audit_logs (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON audit_logs (user_id);

-- ─── Trigger function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_user_id      UUID;
  v_user_name    TEXT;
  v_user_clinic  UUID;
  v_row_clinic   UUID;
  v_old          JSONB;
  v_new          JSONB;
  v_changed      TEXT[];
  v_action       TEXT;
  v_severity     TEXT;
  v_entity_id    TEXT;
  v_key          TEXT;
  v_skip_keys    TEXT[] := ARRAY['updated_at','search_tsv'];
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT clinic_id,
           COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), 'Пользователь')
      INTO v_user_clinic, v_user_name
      FROM user_profiles
     WHERE id = v_user_id;
  ELSE
    v_user_name := 'Система';
  END IF;

  -- Action + diff
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new    := to_jsonb(NEW);
    v_old    := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old    := to_jsonb(OLD);
    v_new    := to_jsonb(NEW);
    v_changed := ARRAY[]::TEXT[];
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key = ANY(v_skip_keys) THEN CONTINUE; END IF;
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old    := to_jsonb(OLD);
    v_new    := NULL;
  END IF;

  -- Severity
  v_severity := CASE TG_TABLE_NAME
    WHEN 'payments'          THEN 'critical'
    WHEN 'lab_orders'        THEN 'high'
    WHEN 'lab_order_items'   THEN 'high'
    WHEN 'reference_ranges'  THEN 'high'
    WHEN 'services'          THEN 'medium'
    WHEN 'appointments'      THEN 'medium'
    ELSE 'low'
  END;

  -- Row clinic_id (fallback to user's)
  BEGIN
    v_row_clinic := COALESCE(
      (COALESCE(v_new, v_old) ->> 'clinic_id')::UUID,
      v_user_clinic
    );
  EXCEPTION WHEN OTHERS THEN
    v_row_clinic := v_user_clinic;
  END;

  -- Entity id
  v_entity_id := COALESCE(v_new, v_old) ->> 'id';

  INSERT INTO audit_logs (
    clinic_id, user_id, user_name, action, entity_type, entity_id,
    old_value, new_value, changed_fields, severity
  ) VALUES (
    v_row_clinic, v_user_id, v_user_name, v_action, TG_TABLE_NAME, v_entity_id,
    v_old, v_new, v_changed, v_severity
  );

  RETURN COALESCE(NEW, OLD);
END
$func$;

-- ─── Attach triggers (idempotent) ──────────────────────────
DO $attach$
DECLARE
  t TEXT;
  targets TEXT[] := ARRAY[
    'patients','appointments','visit_services','payments',
    'lab_orders','lab_order_items','services','reference_ranges'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',
      t, t
    );
  END LOOP;
END
$attach$;

-- ─── RLS ────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Clear any existing policies to keep this idempotent
DO $pol$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename = 'audit_logs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON audit_logs', p.policyname);
  END LOOP;
END
$pol$;

-- SELECT only — own clinic. Writes are done exclusively by the
-- SECURITY DEFINER trigger function owned by postgres (bypasses RLS).
CREATE POLICY "audit_logs_select"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()));
