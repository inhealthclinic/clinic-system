-- ============================================================
-- 082_webhook_errors.sql
-- Лог ошибок webhook'ов (в первую очередь — Green-API).
-- Зачем: при сбое БД роут возвращает 200, чтобы Green-API не штормил
-- ретраями. Из-за этого ошибки тонут в Vercel logs и админка не видит,
-- что сообщения теряются. Эта таблица — приёмник «тихих» ошибок:
-- viewer-страница /settings/audit или прямой SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_errors (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                    -- 'greenapi' | ...
  event_type TEXT,                         -- incomingMessageReceived и т.п.
  external_id TEXT,                        -- idMessage из вебхука, если был
  error_message TEXT NOT NULL,
  error_code TEXT,                         -- SQLSTATE или код провайдера
  payload JSONB,                           -- сырой webhook (для разбора)
  context JSONB,                           -- доп. контекст (clinic_id, deal_id...)
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_errors_unresolved
  ON webhook_errors (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_errors_source_created
  ON webhook_errors (source, created_at DESC);

-- RLS: читать могут только owner/admin клиники. Webhook пишет через
-- service-role key, RLS его не касается.
ALTER TABLE webhook_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_errors_read_owner_admin" ON webhook_errors;
CREATE POLICY "webhook_errors_read_owner_admin" ON webhook_errors
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "webhook_errors_resolve_owner_admin" ON webhook_errors;
CREATE POLICY "webhook_errors_resolve_owner_admin" ON webhook_errors
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND r.slug IN ('owner', 'admin')
    )
  );

COMMENT ON TABLE webhook_errors IS
  'Тихий лог ошибок webhook-обработчиков. Webhook возвращает 200, чтобы провайдер не ретраил, а сюда пишет проблему.';
