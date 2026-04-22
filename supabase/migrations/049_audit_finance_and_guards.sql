-- ============================================================
-- 049_audit_finance_and_guards.sql
-- Пакет A (критические правки без регрессии):
--   1) Расширить audit_logs на финансовые таблицы:
--        charges, cash_sessions, patient_balance, balance_movements
--   2) CHECK (quantity_remaining >= 0) на inventory_batches
--   3) CHECK на refund_reason: обязателен при type='refund'
--   4) BEFORE UPDATE trigger на lab_order_items:
--        результаты, уже помеченные verified_at, защищены от переписи
--        (разрешено только owner’у клиники, если такой явно логин; см. ниже)
-- Миграция идемпотентна.
-- ============================================================

-- ─── 1) Audit triggers на финансовые таблицы ─────────────────
-- fn_audit_trigger() из 024 уже умеет работать с любой таблицей,
-- просто подвешиваем его туда, где раньше не было.
DO $attach$
DECLARE
  t TEXT;
  targets TEXT[] := ARRAY[
    'charges', 'cash_sessions', 'patient_balance', 'balance_movements'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- пропускаем, если таблицы нет (на случай старых окружений)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=t
    ) THEN CONTINUE; END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',
      t, t
    );
  END LOOP;
END
$attach$;

-- Обновим severity для charges/cash_sessions на 'critical'/'high'
-- (fn_audit_trigger вшивает severity по имени таблицы — перепишем функцию).
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

  IF TG_OP = 'INSERT' THEN
    v_action := 'create'; v_new := to_jsonb(NEW); v_old := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update'; v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    v_changed := ARRAY[]::TEXT[];
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key = ANY(v_skip_keys) THEN CONTINUE; END IF;
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete'; v_old := to_jsonb(OLD); v_new := NULL;
  END IF;

  v_severity := CASE TG_TABLE_NAME
    WHEN 'payments'          THEN 'critical'
    WHEN 'charges'           THEN 'high'
    WHEN 'cash_sessions'     THEN 'high'
    WHEN 'patient_balance'   THEN 'high'
    WHEN 'balance_movements' THEN 'high'
    WHEN 'lab_orders'        THEN 'high'
    WHEN 'lab_order_items'   THEN 'high'
    WHEN 'reference_ranges'  THEN 'high'
    WHEN 'services'          THEN 'medium'
    WHEN 'appointments'      THEN 'medium'
    ELSE 'low'
  END;

  BEGIN
    v_row_clinic := COALESCE(
      (COALESCE(v_new, v_old) ->> 'clinic_id')::UUID,
      v_user_clinic
    );
  EXCEPTION WHEN OTHERS THEN
    v_row_clinic := v_user_clinic;
  END;

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

-- ─── 2) CHECK на inventory_batches.quantity_remaining >= 0 ─────
-- Делаем через NOT VALID, чтобы не взорваться на существующих данных,
-- а потом пробуем VALIDATE. Если есть «грязные» строки — миграция не
-- упадёт, но constraint всё равно будет enforced на новые операции.
DO $cq$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='inventory_batches'
      AND column_name='quantity_remaining'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='inventory_batches'
      AND constraint_name='chk_inv_batches_qty_nonneg'
  ) THEN
    ALTER TABLE inventory_batches
      ADD CONSTRAINT chk_inv_batches_qty_nonneg
      CHECK (quantity_remaining >= 0) NOT VALID;
    BEGIN
      ALTER TABLE inventory_batches
        VALIDATE CONSTRAINT chk_inv_batches_qty_nonneg;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'inventory_batches has rows with quantity_remaining < 0; constraint stays NOT VALID (enforced for new writes only)';
    END;
  END IF;
END
$cq$;

-- ─── 3) CHECK на payments: refund_reason обязателен при type='refund' ─
DO $cr$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='payments'
      AND constraint_name='chk_payments_refund_reason'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT chk_payments_refund_reason
      CHECK (type <> 'refund' OR (refund_reason IS NOT NULL AND length(trim(refund_reason)) > 0)) NOT VALID;
    BEGIN
      ALTER TABLE payments VALIDATE CONSTRAINT chk_payments_refund_reason;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'existing refund rows lack refund_reason; constraint stays NOT VALID';
    END;
  END IF;
END
$cr$;

-- ─── 4) Защита от правки верифицированных лаб-результатов ─────
-- Разрешаем менять ТОЛЬКО поля, не связанные с результатом (например,
-- comment, status пометки). Верификацию отзывать — нельзя.
CREATE OR REPLACE FUNCTION fn_lab_item_guard_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Была верифицирована, осталась верифицирована — проверяем защиту
  IF OLD.verified_at IS NOT NULL THEN
    -- запрещаем менять числовой результат / текст / флаг / нормы / единицы
    IF (NEW.result_value  IS DISTINCT FROM OLD.result_value)  OR
       (NEW.result_text   IS DISTINCT FROM OLD.result_text)   OR
       (NEW.flag          IS DISTINCT FROM OLD.flag)          OR
       (NEW.reference_min IS DISTINCT FROM OLD.reference_min) OR
       (NEW.reference_max IS DISTINCT FROM OLD.reference_max) OR
       (NEW.critical_low  IS DISTINCT FROM OLD.critical_low)  OR
       (NEW.critical_high IS DISTINCT FROM OLD.critical_high) OR
       (NEW.unit_snapshot IS DISTINCT FROM OLD.unit_snapshot)
    THEN
      RAISE EXCEPTION 'Результат уже верифицирован (%), изменение запрещено. Отзовите верификацию или создайте новый заказ.',
        OLD.verified_at
        USING ERRCODE = 'check_violation';
    END IF;

    -- запрещаем «де-верификацию» (обнулять verified_at/by)
    IF NEW.verified_at IS NULL OR NEW.verified_by IS NULL THEN
      RAISE EXCEPTION 'Снятие верификации (%). Запрещено через прямой UPDATE.',
        OLD.verified_at
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_lab_item_guard_verified ON lab_order_items;
CREATE TRIGGER trg_lab_item_guard_verified
  BEFORE UPDATE ON lab_order_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_lab_item_guard_verified();

-- Примечание: owner-override оставляем на уровень приложения.
-- В БД — жёсткий запрет, клиентский UI сам принимает решение, кому
-- показывать кнопку «отозвать верификацию» и как это делать (удаление
-- verified_at должно идти через отдельную SECURITY DEFINER функцию,
-- если появится такая операция).
