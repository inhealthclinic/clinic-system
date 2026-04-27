-- ============================================================
-- 075_lab_attachments_bucket.sql
-- Создаём Supabase Storage bucket для вложений лаборатории
-- (фото мазка, гелевые пластинки, сканы).
-- Public read (чтобы ссылку можно было вклеить в PDF-бланк),
-- запись — только authenticated.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('lab-attachments', 'lab-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Читать может любой (публичная ссылка на снимок)
DROP POLICY IF EXISTS "lab_attachments_read" ON storage.objects;
CREATE POLICY "lab_attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'lab-attachments');

-- Загружать — только авторизованные
DROP POLICY IF EXISTS "lab_attachments_insert" ON storage.objects;
CREATE POLICY "lab_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lab-attachments');

-- Удалять — только авторизованные (в UI разрешаем только owner/laborant)
DROP POLICY IF EXISTS "lab_attachments_delete" ON storage.objects;
CREATE POLICY "lab_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lab-attachments');
