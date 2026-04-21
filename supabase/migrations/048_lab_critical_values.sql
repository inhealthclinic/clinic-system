-- ============================================================
-- 048_lab_critical_values.sql
-- Критические (паник-) значения для лаб-анализов.
-- ============================================================
-- Добавляем поля critical_low/high в:
--   • services                — дефолтные пороги на услугу
--   • reference_ranges        — пороги по полу/возрасту/беременности
--   • lab_order_items         — snapshot порогов на момент ввода
-- Обновляем триггер auto_flag_lab_item, чтобы ставить flag='critical',
-- если результат за пределами паник-порогов.
-- ============================================================

-- 1) services — дефолтные пороги
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS critical_low  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS critical_high DECIMAL(12,4);

-- 2) reference_ranges — пороги по группам
ALTER TABLE reference_ranges
  ADD COLUMN IF NOT EXISTS critical_low  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS critical_high DECIMAL(12,4);

-- 3) lab_order_items — snapshot при выставлении результата
ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS critical_low  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS critical_high DECIMAL(12,4);

-- 4) patient_lab_results — чтобы история тоже хранила
ALTER TABLE patient_lab_results
  ADD COLUMN IF NOT EXISTS critical_low  DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS critical_high DECIMAL(12,4);

-- 5) Обновлённый auto-flag:
--    critical  если за паник-порогом
--    low/high  если вне референса
--    normal    если внутри референса
CREATE OR REPLACE FUNCTION auto_flag_lab_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.result_value IS NOT NULL THEN
    -- Сначала проверяем паник-пороги (они приоритетнее обычного low/high)
    IF NEW.critical_low IS NOT NULL AND NEW.result_value < NEW.critical_low THEN
      NEW.flag := 'critical';
    ELSIF NEW.critical_high IS NOT NULL AND NEW.result_value > NEW.critical_high THEN
      NEW.flag := 'critical';
    ELSIF NEW.reference_min IS NOT NULL AND NEW.result_value < NEW.reference_min THEN
      NEW.flag := 'low';
    ELSIF NEW.reference_max IS NOT NULL AND NEW.result_value > NEW.reference_max THEN
      NEW.flag := 'high';
    ELSIF (NEW.reference_min IS NOT NULL OR NEW.reference_max IS NOT NULL) THEN
      NEW.flag := 'normal';
    END IF;

    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_auto_flag_lab_item ON lab_order_items;
CREATE TRIGGER trg_auto_flag_lab_item
  BEFORE INSERT OR UPDATE OF result_value, reference_min, reference_max, critical_low, critical_high
  ON lab_order_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_flag_lab_item();

-- 6) Индекс для быстрого поиска критических (для алертов врачу)
CREATE INDEX IF NOT EXISTS idx_lab_order_items_critical
  ON lab_order_items (order_id) WHERE flag = 'critical';
