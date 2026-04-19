-- ============================================================
-- 014_seed_permissions.sql
-- Системные роли с правами (seed при создании клиники)
-- Вызывается Edge Function при onboarding
-- ============================================================

-- Используем функцию для создания ролей + привязки прав
CREATE OR REPLACE FUNCTION seed_clinic_roles(p_clinic_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  r_owner     UUID; r_admin    UUID; r_doctor UUID;
  r_nurse     UUID; r_laborant UUID; r_cashier UUID; r_manager UUID;
BEGIN
  -- Создаём системные роли
  INSERT INTO roles(clinic_id, name, slug, is_system, color, max_discount_percent)
  VALUES
    (p_clinic_id, 'Админ',          'owner',    true, '#7C3AED', NULL),
    (p_clinic_id, 'Администратор',  'admin',    true, '#2563EB', 20),
    (p_clinic_id, 'Врач',           'doctor',   true, '#059669', 0),
    (p_clinic_id, 'Медсестра',      'nurse',    true, '#0891B2', 0),
    (p_clinic_id, 'Лаборант',       'laborant', true, '#D97706', 0),
    (p_clinic_id, 'Кассир',         'cashier',  true, '#DC2626', 5),
    (p_clinic_id, 'Менеджер',       'manager',  true, '#7C3AED', 10);

  SELECT id INTO r_owner    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'owner';
  SELECT id INTO r_admin    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'admin';
  SELECT id INTO r_doctor   FROM roles WHERE clinic_id = p_clinic_id AND slug = 'doctor';
  SELECT id INTO r_nurse    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'nurse';
  SELECT id INTO r_laborant FROM roles WHERE clinic_id = p_clinic_id AND slug = 'laborant';
  SELECT id INTO r_cashier  FROM roles WHERE clinic_id = p_clinic_id AND slug = 'cashier';
  SELECT id INTO r_manager  FROM roles WHERE clinic_id = p_clinic_id AND slug = 'manager';

  -- OWNER — все права
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_owner, id FROM permissions;

  -- ADMIN
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_admin, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:create','patients:edit','patients:export','patients:merge',
    'crm:view','crm:create','crm:edit',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit','schedule:delete',
    'visit:view','visit:create','visit:edit','visit:close',
    'medcard:view',
    'lab:view','lab:order',
    'finance:view','finance:create','finance:edit','finance:refund','finance:reports','finance:cash_session',
    'inventory:view','inventory:create',
    'analytics:view','analytics:export',
    'tasks:view','tasks:create','tasks:edit',
    'settings:view','settings:users','settings:clinic','settings:doctors',
    'settings:services','settings:notifications','settings:lab_templates'
  );

  -- DOCTOR
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_doctor, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:edit',
    'schedule:view',
    'visit:view','visit:edit','visit:close',
    'medcard:view','medcard:create','medcard:edit','medcard:sign',
    'lab:view','lab:order','lab:verify',
    'tasks:view','tasks:create','tasks:edit'
  );

  -- NURSE
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_nurse, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:edit',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit',
    'visit:view','visit:create',
    'medcard:view',
    'lab:view','lab:order',
    'tasks:view','tasks:create','tasks:edit'
  );

  -- LABORANT
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_laborant, id FROM permissions
  WHERE (module || ':' || action) IN (
    'lab:view','lab:enter_results','lab:verify',
    'inventory:view',
    'tasks:view','tasks:edit'
  );

  -- CASHIER
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_cashier, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view',
    'finance:view','finance:create','finance:cash_session',
    'tasks:view'
  );

  -- MANAGER
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_manager, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:create','patients:edit','patients:merge',
    'crm:view','crm:create','crm:edit',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit',
    'analytics:view',
    'tasks:view','tasks:create','tasks:edit'
  );

END; $$;

-- ============================================================
-- SEED: Drug allergy groups (базовые группы препаратов)
-- ============================================================
INSERT INTO drug_allergy_groups(group_name, drugs) VALUES
  ('Пенициллины',       ARRAY['пенициллин','амоксициллин','ампициллин','флемоксин','амоксиклав','аугментин']),
  ('Цефалоспорины',     ARRAY['цефтриаксон','цефазолин','цефалексин','цефиксим','цефуроксим']),
  ('Фторхинолоны',      ARRAY['ципрофлоксацин','левофлоксацин','офлоксацин','моксифлоксацин']),
  ('Сульфаниламиды',    ARRAY['бисептол','ко-тримоксазол','сульфаметоксазол']),
  ('НПВС',              ARRAY['аспирин','ибупрофен','диклофенак','кетопрофен','нимесулид','мелоксикам']),
  ('Ингибиторы АПФ',    ARRAY['эналаприл','лизиноприл','каптоприл','рамиприл','периндоприл']),
  ('Статины',           ARRAY['аторвастатин','розувастатин','симвастатин','ловастатин']),
  ('Контраст (йод)',    ARRAY['йопромид','йогексол','омнипак','ультравист']);

-- ============================================================
-- SEED: Lab categories
-- ============================================================
INSERT INTO lab_categories(name, code) VALUES
  ('Общий анализ крови',      'OAK'),
  ('Биохимия крови',          'BHK'),
  ('Гормоны',                 'GORM'),
  ('Гемостаз',                'GEMOS'),
  ('Общий анализ мочи',       'OAM'),
  ('Иммунология',             'IMM'),
  ('Инфекции',                'INF'),
  ('Онкомаркеры',             'ONK'),
  ('Генетика',                'GEN'),
  ('Микробиология',           'MIK');
