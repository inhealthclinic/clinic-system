-- ============================================================
-- 100_fix_deals_clinic_id_mismatch.sql
--
-- После импорта amoCRM/CSV у части сделок (deals.clinic_id) оказался
-- не тот clinic_id, что у владеющей воронки (pipelines.clinic_id).
-- Симптом в UI: view v_pipeline_stage_counts джойнит по stage_id
-- глобально и поэтому показывает сотни сделок в шапке /crm, а прямой
-- select из deals под RLS (clinic_id = current_clinic_id()) возвращает
-- 0 строк — канбан выглядит пустым.
--
-- «Родную» клинику сделки определяем однозначно по цепочке
--   deal.stage_id → pipeline_stages.pipeline_id → pipelines.clinic_id
-- и подтягиваем deal.clinic_id к этому значению.
--
-- Только для сделок, у которых stage_id NOT NULL и реально найден
-- в pipeline_stages. Сделки без stage_id (или с битой ссылкой) не
-- трогаем — для них непонятно, какой клинике они принадлежат.
-- ============================================================

UPDATE deals d
SET clinic_id = p.clinic_id
FROM pipeline_stages ps
JOIN pipelines p ON p.id = ps.pipeline_id
WHERE d.stage_id = ps.id
  AND d.clinic_id IS DISTINCT FROM p.clinic_id;

-- Принудительно перечитаем схему, чтобы PostgREST увидел любые ALTER-ы
-- (на этой миграции ALTER нет, но не помешает).
NOTIFY pgrst, 'reload schema';
