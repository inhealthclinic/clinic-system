-- ============================================================
-- 020c_lis_trigger_autoflag.sql — ЧАСТЬ 3/3
-- Авто-флаг в lab_order_items при установке result_value.
-- Запускать ТОЛЬКО после 020a.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_flag_lab_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.result_value IS NOT NULL THEN
    IF NEW.reference_min IS NOT NULL AND NEW.result_value < NEW.reference_min THEN
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
  BEFORE INSERT OR UPDATE OF result_value, reference_min, reference_max
  ON lab_order_items
  FOR EACH ROW
  EXECUTE FUNCTION auto_flag_lab_item();
