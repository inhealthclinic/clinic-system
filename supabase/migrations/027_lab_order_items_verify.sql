-- ============================================================
-- 027_lab_order_items_verify.sql — draft vs verified разделение
-- Добавляет аудит «кто ввёл результат» и «кто верифицировал».
-- Позволяет отличать черновик от подтверждённого результата.
-- Идемпотентно.
-- ============================================================

ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS result_entered_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_entered_by  UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by        UUID REFERENCES user_profiles(id);

-- Backfill: если у строки есть completed_at, но нет result_entered_at —
-- считаем, что entered_at ≈ completed_at (approximation для legacy-данных).
UPDATE lab_order_items
   SET result_entered_at = completed_at
 WHERE result_entered_at IS NULL
   AND completed_at IS NOT NULL;

-- Индексы для быстрого «мои незаверифицированные»
CREATE INDEX IF NOT EXISTS idx_lab_order_items_entered_by
  ON lab_order_items(result_entered_by);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_verified_by
  ON lab_order_items(verified_by);

NOTIFY pgrst, 'reload schema';
