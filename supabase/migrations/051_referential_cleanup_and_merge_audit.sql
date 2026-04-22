-- ============================================================
-- 051_referential_cleanup_and_merge_audit.sql
-- Пакет C (добивка):
--   M3) fn_pipeline_stage_before_delete расширена:
--        - блокирует удаление, если этап упомянут в
--          deal_field_configs.required_in_stages[] (битые FK в JSONB-массиве)
--        - блокирует, если по этапу есть записи в deal_loss_logs
--   M9) merge_patients теперь пишет движение в balance_movements при
--        объединении баланса (audit-trail не теряется).
-- Всё идемпотентно, поверх 003/036.
-- ============================================================

-- ─── M3: расширенная защита удаления этапа ──────────────────
CREATE OR REPLACE FUNCTION fn_pipeline_stage_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
  v_cfg_count INT;
  v_loss_count INT;
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system stage (%)', OLD.code;
  END IF;
  IF NOT OLD.is_deletable THEN
    RAISE EXCEPTION 'Stage (%) is not deletable', OLD.code;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM deals
   WHERE stage_id = OLD.id AND deleted_at IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Stage (%) has % active deals; move or close them first',
      OLD.code, v_count;
  END IF;

  -- NEW: битые ссылки в deal_field_configs.required_in_stages[]
  -- (если pipeline_stages.id содержится в массиве — блок)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='deal_field_configs'
  ) THEN
    EXECUTE '
      SELECT COUNT(*) FROM deal_field_configs
       WHERE $1 = ANY(required_in_stages)
    '
    INTO v_cfg_count
    USING OLD.id;
    IF v_cfg_count > 0 THEN
      RAISE EXCEPTION 'Stage (%) упомянут в % настройках обязательных полей сделки — сначала снимите требование',
        OLD.code, v_cfg_count;
    END IF;
  END IF;

  -- NEW: исторические записи причин потерь на этой стадии
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='deal_loss_logs'
  ) THEN
    EXECUTE '
      SELECT COUNT(*) FROM deal_loss_logs WHERE stage_id = $1
    '
    INTO v_loss_count
    USING OLD.id;
    IF v_loss_count > 0 THEN
      RAISE EXCEPTION 'Stage (%) имеет % записей в истории причин потерь — удаление порушит аудит',
        OLD.code, v_loss_count;
    END IF;
  END IF;

  RETURN OLD;
END
$func$;

-- триггер уже создан в 036, функция обновляется в place.

-- ─── M9: merge_patients с записью в balance_movements ───────
CREATE OR REPLACE FUNCTION merge_patients(
  p_keep_id  UUID,
  p_merge_id UUID,
  p_user_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_keep_number   TEXT;
  v_merge_balance NUMERIC(10,2);
  v_keep_clinic   UUID;
BEGIN
  SELECT patient_number, clinic_id
    INTO v_keep_number, v_keep_clinic
    FROM patients WHERE id = p_keep_id;

  -- Переносим все связи
  UPDATE appointments     SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE visits           SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE charges          SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE payments         SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE lab_orders       SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE medical_records  SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE deals            SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE crm_interactions SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE tasks            SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE patient_consents SET patient_id = p_keep_id WHERE patient_id = p_merge_id;

  -- Объединяем телефоны (убираем дубли)
  UPDATE patients SET
    phones = ARRAY(
      SELECT DISTINCT unnest(
        (SELECT phones FROM patients WHERE id = p_keep_id) ||
        (SELECT phones FROM patients WHERE id = p_merge_id)
      )
    )
  WHERE id = p_keep_id;

  -- Объединяем баланс (с логированием в balance_movements)
  SELECT COALESCE(balance, 0) INTO v_merge_balance
    FROM patient_balance WHERE patient_id = p_merge_id;

  IF COALESCE(v_merge_balance, 0) <> 0 THEN
    UPDATE patient_balance SET
      balance = balance + v_merge_balance
      WHERE patient_id = p_keep_id;

    -- audit-trail: откуда прилетел баланс
    INSERT INTO balance_movements (
      clinic_id, patient_id, type, amount, notes, created_by
    ) VALUES (
      v_keep_clinic,
      p_keep_id,
      CASE WHEN v_merge_balance > 0 THEN 'topup' ELSE 'deduct' END,
      ABS(v_merge_balance),
      'Слияние дублей: баланс перенесён от пациента ' || p_merge_id::text,
      p_user_id
    );

    -- обнуляем баланс у объединяемого
    UPDATE patient_balance SET balance = 0 WHERE patient_id = p_merge_id;
  END IF;

  -- Soft-delete дубля
  UPDATE patients SET
    deleted_at = now(),
    notes = COALESCE(notes,'') || ' | Объединён с ' || v_keep_number
  WHERE id = p_merge_id;

  -- Обновить статус в таблице дублей
  UPDATE patient_duplicates SET
    status = 'merged',
    reviewed_by = p_user_id,
    merged_at = now()
  WHERE (patient_id_1 = p_keep_id AND patient_id_2 = p_merge_id)
     OR (patient_id_1 = p_merge_id AND patient_id_2 = p_keep_id);

  -- Лог в activity_logs (сохраняем старое поведение для совместимости)
  INSERT INTO activity_logs(entity_type, entity_id, action, user_id, metadata, clinic_id)
  VALUES (
    'patient', p_keep_id, 'merged', p_user_id,
    jsonb_build_object('merged_from', p_merge_id, 'balance_moved', COALESCE(v_merge_balance, 0)),
    v_keep_clinic
  );
END
$func$;
