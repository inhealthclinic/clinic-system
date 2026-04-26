-- ============================================================
-- 087_fix_stage_delete_loss_logs.sql
--
-- Fix: fn_pipeline_stage_before_delete (см. 051) ссылается на
--      deal_loss_logs.stage_id — такого столбца нет (см. 036, где
--      таблица создана без stage_id). При попытке удалить стадию
--      падает: column "stage_id" does not exist.
--
-- Исправление: считаем исторические записи причин потерь по этапу
-- через JOIN с deals.stage_id (он существует и индексирован).
-- Все остальные проверки сохраняем как в 051.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_pipeline_stage_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count      INT;
  v_cfg_count  INT;
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

  -- битые ссылки в deal_field_configs.required_in_stages[]
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

  -- исторические записи причин потерь на этой стадии
  -- deal_loss_logs не хранит stage_id напрямую → идём через deals.stage_id
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='deal_loss_logs'
  ) THEN
    EXECUTE '
      SELECT COUNT(*)
        FROM deal_loss_logs dl
        JOIN deals d ON d.id = dl.deal_id
       WHERE d.stage_id = $1
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

NOTIFY pgrst, 'reload schema';
