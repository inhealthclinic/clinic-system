-- ============================================================
-- 081_deal_attachments_bucket.sql
-- Bucket для вложений в чате сделки (deal_messages.attachments).
-- В первую очередь — голосовые записи менеджера (audio/webm), но
-- сюда же положим любые файлы, которые менеджер прикрепляет к
-- сообщению клиенту или к внутреннему примечанию.
--
-- Public read: ссылку нужно отдать клиенту в WhatsApp/Telegram
-- (там нет аутентификации Supabase). Запись — только authenticated.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-attachments', 'deal-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "deal_attachments_read" ON storage.objects;
CREATE POLICY "deal_attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'deal-attachments');

DROP POLICY IF EXISTS "deal_attachments_insert" ON storage.objects;
CREATE POLICY "deal_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-attachments');

DROP POLICY IF EXISTS "deal_attachments_delete" ON storage.objects;
CREATE POLICY "deal_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'deal-attachments');
