-- ============================================================
-- 031_inventory_cost_snapshot.sql — себестоимость движений + аналитика маржи
-- Снапшот себестоимости на момент списания (цена может меняться),
-- перерасчёт по уже существующим writeoff_lab,
-- вьюхи для отчёта «Себестоимость заказов» и «Маржа по услугам».
-- Идемпотентно.
-- ============================================================

-- 0) Нормализация схемы: в inventory_batches должен быть столбец price_per_unit
--    Если в проде стоит старое имя `unit_cost` (из 011) — переименовываем.
--    Если ни того, ни другого — добавляем.
DO $normalize$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_batches'
      AND column_name = 'price_per_unit'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_batches'
        AND column_name = 'unit_cost'
    ) THEN
      ALTER TABLE inventory_batches RENAME COLUMN unit_cost TO price_per_unit;
    ELSE
      ALTER TABLE inventory_batches ADD COLUMN price_per_unit DECIMAL(12,4);
    END IF;
  END IF;
END
$normalize$;

-- 1) cost_snapshot на движениях (qty × price_per_unit партии на момент операции)
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS cost_snapshot DECIMAL(12,4);

CREATE INDEX IF NOT EXISTS idx_movements_lab_order
  ON inventory_movements(lab_order_id)
  WHERE lab_order_id IS NOT NULL;

-- 2) Backfill: проставить cost_snapshot для прежних writeoff_lab по текущей цене партии
UPDATE inventory_movements m
   SET cost_snapshot = m.quantity * b.price_per_unit
  FROM inventory_batches b
 WHERE m.batch_id = b.id
   AND m.cost_snapshot IS NULL
   AND b.price_per_unit IS NOT NULL
   AND m.type IN ('writeoff_lab','writeoff_service','consumption','writeoff','damaged','expired');

-- 3) Обновить FEFO-функцию: стампить cost_snapshot на момент списания
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
        AND is_active  = true
    LOOP
      v_need := v_tmpl.qty_per_service;

      FOR v_batch IN
        SELECT id, quantity_remaining, price_per_unit
        FROM inventory_batches
        WHERE item_type = v_tmpl.item_type
          AND item_id   = v_tmpl.item_id
          AND clinic_id = v_order.clinic_id
          AND is_active = true
          AND quantity_remaining > 0
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

-- 4) Вьюха: себестоимость по каждому лаб-заказу
CREATE OR REPLACE VIEW v_lab_order_costs AS
SELECT
  lo.id                   AS lab_order_id,
  lo.clinic_id,
  lo.patient_id,
  lo.visit_id,
  lo.status,
  lo.ordered_at,
  lo.auto_writeoff_at,
  COALESCE(SUM(m.cost_snapshot),  0)::DECIMAL(12,4)  AS cost_total,
  COUNT(m.id) FILTER (WHERE m.type = 'writeoff_lab') AS movements_count,
  COUNT(DISTINCT m.item_id)                          AS items_used
FROM lab_orders lo
LEFT JOIN inventory_movements m
       ON m.lab_order_id = lo.id
      AND m.type = 'writeoff_lab'
GROUP BY lo.id;

-- 5) Вьюха: маржа по услуге (агрегация за всё время)
CREATE OR REPLACE VIEW v_service_margin AS
SELECT
  s.id                                            AS service_id,
  s.clinic_id,
  s.name                                          AS service_name,
  s.price                                         AS price,
  COUNT(DISTINCT loi.id)                          AS orders_count,
  COALESCE(SUM(m.cost_snapshot), 0)::DECIMAL(12,4) AS cost_total,
  CASE
    WHEN COUNT(DISTINCT loi.id) = 0 THEN NULL
    ELSE (COALESCE(SUM(m.cost_snapshot), 0) / COUNT(DISTINCT loi.id))::DECIMAL(12,4)
  END                                             AS cost_per_order,
  CASE
    WHEN s.price IS NULL OR s.price = 0 THEN NULL
    WHEN COUNT(DISTINCT loi.id) = 0    THEN NULL
    ELSE ((s.price - (COALESCE(SUM(m.cost_snapshot), 0) / COUNT(DISTINCT loi.id))) / s.price * 100)::DECIMAL(6,2)
  END                                             AS margin_pct
FROM services s
LEFT JOIN lab_order_items loi ON loi.service_id = s.id
LEFT JOIN inventory_movements m
       ON m.lab_order_id = loi.order_id
      AND m.type = 'writeoff_lab'
      AND EXISTS (
        SELECT 1 FROM service_inventory_usage siu
         WHERE siu.service_id = s.id
           AND siu.item_type  = m.item_type
           AND siu.item_id    = m.item_id
      )
WHERE s.is_lab = true
GROUP BY s.id;

-- 6) Права доступа на вьюхи (clinic-scope применится через базовые таблицы,
--    но чтоб view был читаем — grant SELECT)
GRANT SELECT ON v_lab_order_costs  TO authenticated;
GRANT SELECT ON v_service_margin   TO authenticated;

NOTIFY pgrst, 'reload schema';
