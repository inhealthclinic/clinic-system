-- ============================================================
-- 033_service_cost_estimate.sql — прогноз себестоимости услуги
-- Вьюха: по шаблонам списания × средняя цена активных партий
-- (clinic × item_type × item_id). Нужна для алерта
-- «цена услуги ниже себестоимости» при редактировании.
-- Идемпотентно.
-- ============================================================

CREATE OR REPLACE VIEW v_service_cost_estimate AS
WITH batch_prices AS (
  SELECT
    item_type,
    item_id,
    clinic_id,
    AVG(price_per_unit) FILTER (
      WHERE price_per_unit IS NOT NULL
        AND COALESCE(is_active, true) = true
        AND quantity_remaining > 0
    ) AS avg_price
  FROM inventory_batches
  GROUP BY item_type, item_id, clinic_id
)
SELECT
  siu.service_id,
  siu.clinic_id,
  COALESCE(SUM(siu.qty_per_service * bp.avg_price), 0)::DECIMAL(12,4) AS estimated_cost,
  COUNT(*) FILTER (WHERE bp.avg_price IS NULL)                       AS missing_price_count,
  COUNT(*)                                                            AS template_items
FROM service_inventory_usage siu
LEFT JOIN batch_prices bp
  ON bp.item_type = siu.item_type
 AND bp.item_id   = siu.item_id
 AND bp.clinic_id = siu.clinic_id
WHERE siu.is_active = true
GROUP BY siu.service_id, siu.clinic_id;

GRANT SELECT ON v_service_cost_estimate TO authenticated;

NOTIFY pgrst, 'reload schema';
