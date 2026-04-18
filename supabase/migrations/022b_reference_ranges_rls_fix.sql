-- ============================================================
-- 022b_reference_ranges_rls_fix.sql
-- Жёсткий пересоздаёт RLS-политики на reference_ranges:
-- "new row violates row-level security policy" обычно означает,
-- что политика без WITH CHECK или для другой роли.
-- ============================================================

ALTER TABLE reference_ranges ENABLE ROW LEVEL SECURITY;

-- Снести все политики на таблице
DO $fix$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'reference_ranges'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON reference_ranges', pol.policyname);
  END LOOP;
END
$fix$;

-- Чтение всем авторизованным
CREATE POLICY "reference_ranges_select"
  ON reference_ranges FOR SELECT
  TO authenticated
  USING (true);

-- Вставка/изменение/удаление — всем авторизованным
CREATE POLICY "reference_ranges_insert"
  ON reference_ranges FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "reference_ranges_update"
  ON reference_ranges FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "reference_ranges_delete"
  ON reference_ranges FOR DELETE
  TO authenticated
  USING (true);
