-- ============================================================
-- SEED DATA — IN HEALTH clinic
-- Run after migrations to bootstrap the system
-- ============================================================

-- 1. Clinic
INSERT INTO clinics (id, name, address, phone, email, timezone, currency)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'IN HEALTH',
  'г. Актау, 11 микрорайон',
  '+7 701 000 0000',
  'admin@inhealth.kz',
  'Asia/Almaty',
  'KZT'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Roles
INSERT INTO roles (clinic_id, name, slug, is_system, color, max_discount_percent)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Админ',         'owner',   true, '#6B21A8', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Администратор', 'admin',   true, '#1D4ED8', 20),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Врач',          'doctor',  true, '#059669', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Медсестра',     'nurse',   true, '#0891B2', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Кассир',        'cashier', true, '#B45309', 5),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Менеджер',      'manager', true, '#DC2626', 10)
ON CONFLICT (clinic_id, slug) DO NOTHING;

-- NOTE: After running this seed, manually create admin user via Supabase Auth,
-- then insert their user_profile:
--
-- INSERT INTO user_profiles (id, clinic_id, role_id, first_name, last_name)
-- SELECT
--   '<auth_user_id>',
--   'aaaaaaaa-0000-0000-0000-000000000001',
--   r.id,
--   'Админ',
--   'IN HEALTH'
-- FROM roles r
-- WHERE r.clinic_id = 'aaaaaaaa-0000-0000-0000-000000000001'
--   AND r.slug = 'owner';
