-- ============================================================
-- 050_hard_guards.sql
-- Пакет B: жёсткие гарантии в БД, которые раньше держал только клиент.
--   1) visits: BEFORE UPDATE → при переходе в 'completed' вызываем
--      validate_visit_close() и блокируем закрытие, если не готов.
--   2) deals: loss_reason теперь обязателен И при INSERT в lost-стадию
--      (раньше триггер был только на UPDATE stage_id).
--   3) lab_orders: жёсткий граф статусов (рекомендательный направо,
--      'rejected' допустим из любого рабочего состояния, 'delivered'
--      только из 'verified'/'ready').
--   4) prescription_items: мягкая защита от назначения препарата,
--      совпадающего с аллергией пациента — НЕ блокируем, но пишем в
--      audit_logs с severity='critical', чтобы алерт пошёл врачу/owner.
-- Всё идемпотентно.
-- ============================================================

-- ─── 1) visits close guard ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_visit_close_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_ok     BOOLEAN;
  v_reason TEXT;
BEGIN
  -- Срабатываем только на переход к completed (или partial, если используется)
  IF NEW.status IN ('completed','partial')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('completed','partial')) THEN
    SELECT ok, reason INTO v_ok, v_reason
      FROM validate_visit_close(NEW.id);
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'Нельзя закрыть визит: %', COALESCE(v_reason, 'неизвестная причина')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_visit_close_guard ON visits;
CREATE TRIGGER trg_visit_close_guard
  BEFORE UPDATE OF status ON visits
  FOR EACH ROW EXECUTE FUNCTION fn_visit_close_guard();

-- ─── 2) loss_reason обязателен и на INSERT ─────────────────
CREATE OR REPLACE FUNCTION fn_deal_require_loss_reason()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE v_role TEXT;
BEGIN
  -- INSERT: если сразу создают в lost-стадию — требуем reason
  IF TG_OP = 'INSERT' AND NEW.stage_id IS NOT NULL THEN
    SELECT stage_role INTO v_role FROM pipeline_stages WHERE id = NEW.stage_id;
    IF v_role = 'lost' AND NEW.loss_reason_id IS NULL THEN
      RAISE EXCEPTION 'Loss reason required when creating deal directly in lost stage'
        USING ERRCODE = '23514';
    END IF;
  -- UPDATE: сохраняем прежнюю логику — только при смене stage_id
  ELSIF TG_OP = 'UPDATE'
        AND NEW.stage_id IS DISTINCT FROM OLD.stage_id
        AND NEW.stage_id IS NOT NULL THEN
    SELECT stage_role INTO v_role FROM pipeline_stages WHERE id = NEW.stage_id;
    IF v_role = 'lost' AND NEW.loss_reason_id IS NULL THEN
      RAISE EXCEPTION 'Loss reason required when moving deal to lost stage'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_deal_require_loss_reason        ON deals;
DROP TRIGGER IF EXISTS trg_deal_require_loss_reason_insert ON deals;
CREATE TRIGGER trg_deal_require_loss_reason
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_require_loss_reason();
CREATE TRIGGER trg_deal_require_loss_reason_insert
  BEFORE INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION fn_deal_require_loss_reason();

-- ─── 3) lab_orders: граф статусов ───────────────────────────
-- Разрешённые последовательности:
--   ordered → agreed → (paid) → sample_taken → in_progress → ready → verified → delivered
--   Ветка: rejected достижим из любого из {ordered, agreed, paid, sample_taken, in_progress}
--   Разрешаем «назад» только ordered←agreed (если отменили согласование)
--   и оставляем оператору возможность out-of-band только через service_role.
CREATE OR REPLACE FUNCTION fn_lab_order_status_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Карта допустимых переходов (old → new)
  v_allowed := CASE
    WHEN OLD.status = 'ordered'      AND NEW.status IN ('agreed','rejected')                            THEN true
    WHEN OLD.status = 'agreed'       AND NEW.status IN ('paid','sample_taken','ordered','rejected')     THEN true
    WHEN OLD.status = 'paid'         AND NEW.status IN ('sample_taken','rejected')                      THEN true
    WHEN OLD.status = 'sample_taken' AND NEW.status IN ('in_progress','rejected')                       THEN true
    WHEN OLD.status = 'in_progress'  AND NEW.status IN ('ready','rejected')                             THEN true
    WHEN OLD.status = 'ready'        AND NEW.status IN ('verified','delivered')                         THEN true
    WHEN OLD.status = 'verified'     AND NEW.status = 'delivered'                                       THEN true
    WHEN OLD.status = 'delivered'                                                                       THEN false
    WHEN OLD.status = 'rejected'                                                                        THEN false
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Недопустимый переход статуса лаб-заказа: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_lab_order_status_guard ON lab_orders;
CREATE TRIGGER trg_lab_order_status_guard
  BEFORE UPDATE OF status ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION fn_lab_order_status_guard();

-- ─── 4) prescription_items: аллерго-алерт (warning, не блок) ──
CREATE OR REPLACE FUNCTION fn_prescription_allergy_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_patient_id UUID;
  v_clinic_id  UUID;
  v_match      BOOLEAN := false;
  v_allergen   TEXT;
  v_user_id    UUID;
  v_user_name  TEXT;
  v_drug_lower TEXT;
BEGIN
  -- Получаем пациента из родительского рецепта
  SELECT patient_id, clinic_id
    INTO v_patient_id, v_clinic_id
    FROM prescriptions
   WHERE id = NEW.prescription_id;

  IF v_patient_id IS NULL OR NEW.name IS NULL THEN
    RETURN NEW;
  END IF;

  v_drug_lower := lower(NEW.name);

  -- 1) прямое совпадение с аллергеном пациента
  SELECT a.allergen INTO v_allergen
    FROM allergies a
   WHERE a.patient_id = v_patient_id
     AND a.type = 'drug'
     AND lower(a.allergen) = v_drug_lower
   LIMIT 1;

  IF v_allergen IS NOT NULL THEN
    v_match := true;
  ELSE
    -- 2) совпадение через drug_allergy_groups: если у пациента есть
    --    аллергия на ЛЮБОЙ препарат из группы, в которую входит NEW.name
    SELECT g.group_name INTO v_allergen
      FROM drug_allergy_groups g
      JOIN allergies a ON a.patient_id = v_patient_id AND a.type = 'drug'
     WHERE v_drug_lower = ANY (ARRAY(SELECT lower(unnest(g.drugs))))
       AND lower(a.allergen) = ANY (ARRAY(SELECT lower(unnest(g.drugs))))
     LIMIT 1;
    IF v_allergen IS NOT NULL THEN
      v_match := true;
    END IF;
  END IF;

  IF v_match THEN
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
      SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), 'Пользователь')
        INTO v_user_name
        FROM user_profiles WHERE id = v_user_id;
    ELSE
      v_user_name := 'Система';
    END IF;

    INSERT INTO audit_logs (
      clinic_id, user_id, user_name, action, entity_type, entity_id,
      old_value, new_value, changed_fields, severity
    ) VALUES (
      v_clinic_id, v_user_id, v_user_name,
      'allergy_alert', 'prescription_items', NEW.id::text,
      NULL,
      jsonb_build_object(
        'prescription_id', NEW.prescription_id,
        'drug_name',       NEW.name,
        'matched_group',   v_allergen,
        'patient_id',      v_patient_id
      ),
      ARRAY['name'], 'critical'
    );
    -- не блокируем: клиент обязан показать подтверждение перед save
  END IF;

  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_prescription_allergy_alert ON prescription_items;
CREATE TRIGGER trg_prescription_allergy_alert
  AFTER INSERT ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION fn_prescription_allergy_alert();
