-- ============================================================
-- 033_service_cost_estimate.sql — прогноз себестоимости услуги
-- Вьюха: по шаблонам списания × средняя цена активных партий
-- (clinic × item_type × item_id). Нужна для алерта
-- «цена услуги ниже себестоимости» при редактировании.
-- Идемпотентно.
-- ============================================================

-- 0) Нормализация схемы inventory_batches.
--    В проде застряли имена из миграции 011 (remaining, quantity).
--    UI и эта вьюха ожидают quantity_remaining / quantity_initial.
DO $normalize_batches$
BEGIN
  -- remaining → quantity_remaining
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_batches' AND column_name = 'quantity_remaining'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_batches' AND column_name = 'remaining'
    ) THEN
      ALTER TABLE inventory_batches RENAME COLUMN remaining TO quantity_remaining;
    ELSE
      ALTER TABLE inventory_batches ADD COLUMN quantity_remaining DECIMAL(10,3) NOT NULL DEFAULT 0;
    END IF;
  END IF;

  -- quantity → quantity_initial (UI показывает исходное кол-во партии)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_batches' AND column_name = 'quantity_initial'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_batches' AND column_name = 'quantity'
    ) THEN
      ALTER TABLE inventory_batches RENAME COLUMN quantity TO quantity_initial;
    END IF;
    -- если ни того, ни другого — не добавляем: вьюхе не нужно, UI сам выставит при приходе
  END IF;

  -- Полезные колонки, на которые UI полагается, добавляем если нет.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_batches' AND column_name='unit') THEN
    ALTER TABLE inventory_batches ADD COLUMN unit TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_batches' AND column_name='supplier') THEN
    ALTER TABLE inventory_batches ADD COLUMN supplier TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_batches' AND column_name='manufactured_at') THEN
    ALTER TABLE inventory_batches ADD COLUMN manufactured_at DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_batches' AND column_name='is_active') THEN
    ALTER TABLE inventory_batches ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
  END IF;
END
$normalize_batches$;

CREATE OR REPLACE VIEW v_service_cost_estimate AS
WITH batch_prices AS (
  SELECT
    item_type,
    item_id,
    clinic_id,
    AVG(price_per_unit) FILTER (
      WHERE price_per_unit IS NOT NULL
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
