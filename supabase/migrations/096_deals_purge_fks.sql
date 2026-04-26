-- ============================================================
-- 096_deals_purge_fks.sql — позволяем безвозвратно удалять сделку.
--
-- Контекст: в /crm/trash появилась кнопка «Удалить навсегда» (для owner).
-- Удаление падало с
--   `update or delete on table "deals" violates foreign key constraint
--    "appointments_deal_id_fkey" on table "appointments"`
-- Колонки `deal_id` в appointments/visits/charges/tasks/crm_interactions/
-- whatsapp_messages исторически создавались без `ON DELETE SET NULL`
-- (миграция 037 добавляла это поведение, но только если колонок ещё не
-- было). На уже накатанных базах FK по умолчанию = NO ACTION → DELETE
-- блокируется. Переcоздаём все «мягкие» FK к deals с `ON DELETE SET NULL`,
-- сохраняя историю визитов/денег/коммуникаций.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage cu
        ON cu.constraint_name = tc.constraint_name
       AND cu.constraint_schema = tc.constraint_schema
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND cu.table_name = 'deals'
       AND cu.column_name = 'id'
       AND kcu.column_name = 'deal_id'
       AND tc.table_name IN (
         'appointments','visits','charges',
         'tasks','crm_interactions','whatsapp_messages'
       )
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL',
      r.table_name, r.constraint_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
