-- 078_doctor_personal_settings.sql
-- Персональные настройки врача: подпись для PDF + избранные ICD-10 и препараты

ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS signature_url    TEXT,
  ADD COLUMN IF NOT EXISTS favorite_icd10   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS favorite_drugs   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS prescription_header TEXT;

COMMENT ON COLUMN doctors.signature_url IS 'URL изображения подписи (для PDF-рецептов)';
COMMENT ON COLUMN doctors.favorite_icd10 IS 'Избранные коды [{code,name}]';
COMMENT ON COLUMN doctors.favorite_drugs IS 'Избранные препараты [{name,form,dosage,frequency,duration}]';
COMMENT ON COLUMN doctors.prescription_header IS 'Персональная шапка на PDF-рецепт (ФИО, регалии, кабинет)';

-- Bucket для подписей врачей (публичный — печатается в PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signatures', 'signatures', true, 2 * 1024 * 1024, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- RLS: любой аутентифицированный врач клиники может загружать/читать своей клиники
CREATE POLICY IF NOT EXISTS "signatures_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'signatures');

CREATE POLICY IF NOT EXISTS "signatures_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'signatures' AND auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "signatures_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'signatures' AND auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "signatures_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'signatures' AND auth.role() = 'authenticated');

