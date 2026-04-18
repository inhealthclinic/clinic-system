-- ============================================================
-- 032_lab_costs_monthly_view.sql — агрегация себестоимости по месяцам
-- Вьюха для графика тренда: сумма cost_snapshot + кол-во заказов
-- по (clinic_id × месяц).
-- Идемпотентно.
-- ============================================================

CREATE OR REPLACE VIEW v_lab_costs_monthly AS
SELECT
  lo.clinic_id,
  date_trunc('month', lo.ordered_at)::DATE              AS month,
  COUNT(DISTINCT lo.id)                                  AS orders_count,
  COALESCE(SUM(m.cost_snapshot), 0)::DECIMAL(12,4)       AS cost_total
FROM lab_orders lo
LEFT JOIN inventory_movements m
       ON m.lab_order_id = lo.id
      AND m.type = 'writeoff_lab'
WHERE lo.ordered_at IS NOT NULL
GROUP BY lo.clinic_id, date_trunc('month', lo.ordered_at);

GRANT SELECT ON v_lab_costs_monthly TO authenticated;

NOTIFY pgrst, 'reload schema';
