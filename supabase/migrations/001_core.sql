-- ============================================================
-- 001_core.sql
-- Клиника, RBAC (роли, права, пользователи)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- CLINICS
-- ============================================================
CREATE TABLE clinics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  email      TEXT,
  logo_url   TEXT,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Almaty',
  currency   TEXT NOT NULL DEFAULT 'KZT',
  settings   JSONB NOT NULL DEFAULT '{}',
  -- settings: { working_hours, default_appointment_duration, sms_sender_name, ... }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROLES (гибкие, создаются owner)
-- ============================================================
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  -- системные: owner / admin / doctor / nurse / laborant / cashier / manager
  is_system   BOOLEAN NOT NULL DEFAULT false,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  -- owner: NULL (без лимита), admin: 20, cashier: 5, doctor: 0
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, slug)
);

-- owner не имеет лимита скидки (NULL)
ALTER TABLE roles ALTER COLUMN max_discount_percent DROP NOT NULL;

-- ============================================================
-- PERMISSIONS (полный список прав системы)
-- ============================================================
CREATE TABLE permissions (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module  TEXT NOT NULL,
  -- patients / crm / schedule / visit / medcard / lab
  -- finance / inventory / analytics / settings / tasks
  action  TEXT NOT NULL,
  -- view / create / edit / delete / export / approve / sign
  -- view_all / edit_result / approve_discount / writeoff / merge
  name    TEXT NOT NULL,
  UNIQUE(module, action)
);

-- ============================================================
-- ROLE ↔ PERMISSIONS
-- ============================================================
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

-- ============================================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE user_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id           UUID NOT NULL REFERENCES clinics(id),
  role_id             UUID NOT NULL REFERENCES roles(id),
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  middle_name         TEXT,
  phone               TEXT,
  avatar_url          TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  -- Точечная настройка прав (дополнительные / запреты поверх роли)
  extra_permissions   UUID[] NOT NULL DEFAULT '{}',
  denied_permissions  UUID[] NOT NULL DEFAULT '{}',
  last_login          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ФУНКЦИИ
-- ============================================================

-- Проверка права пользователя
CREATE OR REPLACE FUNCTION has_permission(p_user UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    -- Owner — всё разрешено
    EXISTS(
      SELECT 1 FROM user_profiles up
      JOIN roles r ON r.id = up.role_id
      WHERE up.id = p_user AND r.slug = 'owner'
    )
    OR (
      -- Право через роль
      EXISTS(
        SELECT 1 FROM user_profiles up
        JOIN role_permissions rp ON rp.role_id = up.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE up.id = p_user
          AND (p.module || ':' || p.action) = p_perm
          AND NOT (
            p_perm = ANY(
              COALESCE(
                ARRAY(SELECT unnest(up.denied_permissions)::TEXT),
                '{}'
              )
            )
          )
      )
    )
    -- Дополнительное право
    OR EXISTS(
      SELECT 1 FROM user_profiles up
      JOIN permissions p ON p.id = ANY(up.extra_permissions)
      WHERE up.id = p_user
        AND (p.module || ':' || p.action) = p_perm
    );
$$;

-- Получить clinic_id текущего пользователя
CREATE OR REPLACE FUNCTION current_clinic_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT clinic_id FROM user_profiles WHERE id = auth.uid();
$$;

-- Обновление updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE clinics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;

-- Clinics: пользователь видит только свою клинику
CREATE POLICY "clinics: own" ON clinics
  FOR ALL USING (id = current_clinic_id());

-- Roles: только своя клиника
CREATE POLICY "roles: own clinic" ON roles
  FOR ALL USING (clinic_id = current_clinic_id());

-- Permissions: читают все авторизованные
CREATE POLICY "permissions: read all" ON permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Role permissions: своя клиника
CREATE POLICY "role_permissions: own clinic" ON role_permissions
  FOR ALL USING (
    role_id IN (SELECT id FROM roles WHERE clinic_id = current_clinic_id())
  );

-- User profiles: своя клиника
CREATE POLICY "user_profiles: own clinic" ON user_profiles
  FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_user_profiles_clinic ON user_profiles(clinic_id);
CREATE INDEX idx_user_profiles_role   ON user_profiles(role_id);
CREATE INDEX idx_roles_clinic         ON roles(clinic_id);

-- ============================================================
-- SEED — ВСЕ ПРАВА СИСТЕМЫ
-- ============================================================
INSERT INTO permissions (module, action, name) VALUES
  -- Пациенты
  ('patients', 'view',           'Просмотр пациентов'),
  ('patients', 'create',         'Создание пациентов'),
  ('patients', 'edit',           'Редактирование пациентов'),
  ('patients', 'delete',         'Удаление пациентов'),
  ('patients', 'export',         'Экспорт пациентов'),
  ('patients', 'merge',          'Слияние дублей пациентов'),
  -- CRM
  ('crm', 'view',                'Просмотр CRM'),
  ('crm', 'create',              'Создание сделок'),
  ('crm', 'edit',                'Редактирование сделок'),
  ('crm', 'delete',              'Удаление сделок'),
  -- Расписание
  ('schedule', 'view',           'Просмотр расписания'),
  ('schedule', 'view_all',       'Просмотр расписания всех врачей'),
  ('schedule', 'create',         'Создание записей'),
  ('schedule', 'edit',           'Редактирование записей'),
  ('schedule', 'delete',         'Удаление записей'),
  -- Визиты
  ('visit', 'view',              'Просмотр визитов'),
  ('visit', 'create',            'Создание визитов'),
  ('visit', 'edit',              'Редактирование визитов'),
  ('visit', 'close',             'Закрытие визитов'),
  -- Медкарта
  ('medcard', 'view',            'Просмотр медкарты'),
  ('medcard', 'create',          'Создание записей приёма'),
  ('medcard', 'edit',            'Редактирование медкарты'),
  ('medcard', 'sign',            'Подпись медкарты'),
  ('medcard', 'delete',          'Удаление записей медкарты'),
  -- Лаборатория
  ('lab', 'view',                'Просмотр лаборатории'),
  ('lab', 'order',               'Назначение анализов'),
  ('lab', 'enter_results',       'Ввод результатов'),
  ('lab', 'verify',              'Верификация результатов'),
  ('lab', 'edit_result',         'Редактирование результатов'),
  -- Финансы
  ('finance', 'view',            'Просмотр финансов'),
  ('finance', 'create',          'Создание начислений и оплат'),
  ('finance', 'edit',            'Редактирование финансов'),
  ('finance', 'refund',          'Возвраты'),
  ('finance', 'reports',         'Финансовые отчёты'),
  ('finance', 'approve_discount','Одобрение скидок'),
  ('finance', 'cash_session',    'Управление кассовыми сменами'),
  -- Склад
  ('inventory', 'view',          'Просмотр склада'),
  ('inventory', 'create',        'Приход товара'),
  ('inventory', 'writeoff',      'Ручное списание склада'),
  -- Аналитика
  ('analytics', 'view',          'Просмотр аналитики'),
  ('analytics', 'export',        'Экспорт отчётов'),
  -- Задачи
  ('tasks', 'view',              'Просмотр задач'),
  ('tasks', 'create',            'Создание задач'),
  ('tasks', 'edit',              'Редактирование задач'),
  -- Настройки
  ('settings', 'view',           'Просмотр настроек'),
  ('settings', 'users',          'Управление пользователями'),
  ('settings', 'roles',          'Управление ролями'),
  ('settings', 'clinic',         'Настройки клиники'),
  ('settings', 'doctors',        'Управление врачами'),
  ('settings', 'services',       'Управление услугами'),
  ('settings', 'notifications',  'Настройки уведомлений'),
  ('settings', 'lab_templates',  'Шаблоны анализов');
