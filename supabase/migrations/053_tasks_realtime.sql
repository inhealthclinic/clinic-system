-- ============================================================
-- 053_tasks_realtime.sql
-- Включаем таблицы tasks и deal_tasks в publication
-- supabase_realtime. Без этого postgres_changes INSERT/UPDATE
-- не доставляются подписчикам, и TaskNotifier молчит, когда
-- в CRM ставят задачу ответственному.
--
-- Идемпотентно: проверяем, что таблица ещё не в publication.
-- ============================================================

DO $$
BEGIN
  -- tasks
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;

  -- deal_tasks
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'deal_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_tasks;
  END IF;
END $$;

-- REPLICA IDENTITY FULL нужен, чтобы в payload.old (для UPDATE/DELETE)
-- приезжали все колонки, а не только PK. Для INSERT не обязателен,
-- но при будущем расширении пригодится.
ALTER TABLE public.tasks       REPLICA IDENTITY FULL;
ALTER TABLE public.deal_tasks  REPLICA IDENTITY FULL;
