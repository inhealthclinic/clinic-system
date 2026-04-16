-- ============================================================
-- 006_appointment_color.sql
-- Добавляет цвет и тип к записям в расписании
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS appt_type TEXT DEFAULT NULL;
