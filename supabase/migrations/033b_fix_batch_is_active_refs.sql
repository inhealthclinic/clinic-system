-- ============================================================
-- 033b_fix_batch_is_active_refs.sql — фикс ссылок на inventory_batches.is_active
-- В проде у inventory_batches нет столбца is_active.
-- Функция fn_lab_order_auto_writeoff (создавалась в 030/031) ссылается на него
-- внутри FOR-loop → упадёт при первом срабатывании триггера на sample_taken.
-- Пересоздаём функцию без фильтра is_active (пустые партии отсекаются
-- условием quantity_remaining > 0).
-- Идемпотентно.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_lab_order_auto_writeoff(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_order       lab_orders%ROWTYPE;
  v_item        RECORD;
  v_tmpl        RECORD;
  v_batch       RECORD;
  v_need        DECIMAL(10,3);
  v_used        DECIMAL(10,3);
  v_cost        DECIMAL(12,4);
BEGIN
  SELECT * INTO v_order FROM lab_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_order.auto_writeoff_at IS NOT NULL THEN RETURN; END IF;
  IF v_order.clinic_id IS NULL THEN RETURN; END IF;

  FOR v_item IN
    SELECT id, service_id FROM lab_order_items WHERE order_id = p_order_id
  LOOP
    IF v_item.service_id IS NULL THEN CONTINUE; END IF;

    FOR v_tmpl IN
      SELECT item_type, item_id, qty_per_service
      FROM service_inventory_usage
      WHERE service_id = v_item.service_id
        AND clinic_id  = v_order.clinic_id
        AND is_active  = true         -- на service_inventory_usage столбец точно есть (создан в 030)
    LOOP
      v_need := v_tmpl.qty_per_service;

      FOR v_batch IN
        SELECT id, quantity_remaining, price_per_unit
        FROM inventory_batches
        WHERE item_type = v_tmpl.item_type
          AND item_id   = v_tmpl.item_id
          AND clinic_id = v_order.clinic_id
          AND quantity_remaining > 0    -- убран is_active (нет такого столбца в проде)
        ORDER BY COALESCE(expires_at, '9999-12-31'), created_at
      LOOP
        EXIT WHEN v_need <= 0;
        v_used := LEAST(v_need, v_batch.quantity_remaining);
        v_cost := CASE
                    WHEN v_batch.price_per_unit IS NULL THEN NULL
                    ELSE v_used * v_batch.price_per_unit
                  END;

        UPDATE inventory_batches
           SET quantity_remaining = quantity_remaining - v_used
         WHERE id = v_batch.id;

        INSERT INTO inventory_movements(
          clinic_id, batch_id, item_type, item_id, type,
          quantity, lab_order_id, notes, cost_snapshot
        ) VALUES (
          v_order.clinic_id, v_batch.id, v_tmpl.item_type, v_tmpl.item_id,
          'writeoff_lab', v_used, p_order_id,
          'Авто-списание по забору образца', v_cost
        );

        v_need := v_need - v_used;
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE lab_orders SET auto_writeoff_at = now() WHERE id = p_order_id;
END
$fn$;

NOTIFY pgrst, 'reload schema';
