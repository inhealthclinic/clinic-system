-- ============================================================
-- 091_crm_attachments_bucket.sql
-- Storage bucket для вложений CRM-чата (голосовые, картинки, файлы).
-- Public read — нужно, чтобы Green-API смог скачать файл по URL
-- через sendFileByUrl. Запись — только authenticated.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('crm-attachments', 'crm-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crm_attachments_read" ON storage.objects;
CREATE POLICY "crm_attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'crm-attachments');

DROP POLICY IF EXISTS "crm_attachments_insert" ON storage.objects;
CREATE POLICY "crm_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-attachments');

DROP POLICY IF EXISTS "crm_attachments_delete" ON storage.objects;
CREATE POLICY "crm_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crm-attachments');
