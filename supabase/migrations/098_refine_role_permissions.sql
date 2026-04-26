-- ============================================================
-- 098_refine_role_permissions.sql — доработка матрицы ролей и прав
-- по реальному функционалу.
--
-- Что не так в исходных дефолтах (014):
--   • doctor: lab:verify без lab:enter_results — нарушение PREREQS
--     (verify требует enter_results) → жёлтое предупреждение в UI и
--     невозможность реально верифицировать без права ввода результата.
--   • doctor: нет visit:create — на walk-in врач не может стартовать визит.
--   • doctor: нет crm:view — а во время приёма часто нужен контекст лида.
--   • doctor: нет analytics:view — врач должен видеть свои метрики.
--   • admin: нет medcard:create/edit — администратор не может занести
--     запись задним числом / поправить опечатку (подпись остаётся за
--     врачом — sign не даём).
--   • admin: нет inventory:writeoff — управление складом разумно у админа.
--   • nurse: нет inventory:view — медсестра не видит расходники, которые
--     сама же тратит.
--   • nurse: нет crm:view — не видит карточки лида в расписании.
--   • nurse: нет visit:edit — может создать визит, но не отредактировать.
--   • laborant: нет patients:view — лаборант смотрит результаты «в воздухе»,
--     не видя, чьи это анализы.
--   • laborant: нет inventory:create/writeoff — реагенты он сам и принимает,
--     и списывает, по дефолту это закрыто.
--   • cashier: нет schedule:view / visit:view — кассир должен видеть, за что
--     выставлять чек.
--   • cashier: нет finance:edit/refund/reports — без edit нельзя поправить
--     ошибочный платёж, без refund невозможен возврат, без reports
--     не закроет смену по отчёту.
--   • manager: нет patients:export/crm:delete — менеджер ведёт сделки end-to-end.
--   • manager: нет visit:view / finance:view — не видит, что с записанным
--     лидом происходит дальше. Без этого CRM-воронка слепая после прихода.
--
-- Решение:
--   1) Переписываем seed_clinic_roles() с правильными грантами
--      (для будущих клиник).
--   2) Точечный idempotent-апдейт: для существующих СИСТЕМНЫХ ролей
--      (is_system = true) перезаписываем матрицу под новые дефолты.
--      Кастомные роли (is_system = false) НЕ трогаем — у клиента могут
--      быть свои настройки.
-- ============================================================

CREATE OR REPLACE FUNCTION seed_clinic_roles(p_clinic_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  r_owner    UUID; r_admin    UUID; r_doctor UUID;
  r_nurse    UUID; r_laborant UUID; r_cashier UUID; r_manager UUID;
BEGIN
  -- Создаём системные роли (idempotent через ON CONFLICT по (clinic_id, slug))
  INSERT INTO roles(clinic_id, name, slug, is_system, color, max_discount_percent)
  VALUES
    (p_clinic_id, 'Владелец',       'owner',    true, '#7C3AED', NULL),
    (p_clinic_id, 'Администратор',  'admin',    true, '#2563EB', 20),
    (p_clinic_id, 'Врач',           'doctor',   true, '#059669', 0),
    (p_clinic_id, 'Медсестра',      'nurse',    true, '#0891B2', 0),
    (p_clinic_id, 'Лаборант',       'laborant', true, '#D97706', 0),
    (p_clinic_id, 'Кассир',         'cashier',  true, '#DC2626', 5),
    (p_clinic_id, 'Менеджер',       'manager',  true, '#0EA5E9', 10)
  ON CONFLICT (clinic_id, slug) DO NOTHING;

  SELECT id INTO r_owner    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'owner';
  SELECT id INTO r_admin    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'admin';
  SELECT id INTO r_doctor   FROM roles WHERE clinic_id = p_clinic_id AND slug = 'doctor';
  SELECT id INTO r_nurse    FROM roles WHERE clinic_id = p_clinic_id AND slug = 'nurse';
  SELECT id INTO r_laborant FROM roles WHERE clinic_id = p_clinic_id AND slug = 'laborant';
  SELECT id INTO r_cashier  FROM roles WHERE clinic_id = p_clinic_id AND slug = 'cashier';
  SELECT id INTO r_manager  FROM roles WHERE clinic_id = p_clinic_id AND slug = 'manager';

  -- Чистим прошлые гранты системных ролей (idempotent)
  DELETE FROM role_permissions
   WHERE role_id IN (r_owner, r_admin, r_doctor, r_nurse, r_laborant, r_cashier, r_manager);

  -- OWNER — все права
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_owner, id FROM permissions;

  -- ADMIN — может всё, кроме destructive ops, одобрения скидок,
  -- редактирования лаб-результатов, подписи медкарты, ролевой матрицы.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_admin, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:create','patients:edit','patients:export','patients:merge',
    'crm:view','crm:create','crm:edit',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit','schedule:delete',
    'visit:view','visit:create','visit:edit','visit:close',
    'medcard:view','medcard:create','medcard:edit',
    'lab:view','lab:order',
    'finance:view','finance:create','finance:edit','finance:refund','finance:reports','finance:cash_session',
    'inventory:view','inventory:create','inventory:writeoff',
    'analytics:view','analytics:export',
    'tasks:view','tasks:create','tasks:edit',
    'settings:view','settings:users','settings:clinic','settings:doctors',
    'settings:services','settings:notifications','settings:lab_templates'
  );

  -- DOCTOR — клинический работник: свои пациенты, медкарта (с подписью),
  -- расписание (только своё), CRM-контекст для приёма.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_doctor, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:edit',
    'crm:view',
    'schedule:view',
    'visit:view','visit:create','visit:edit','visit:close',
    'medcard:view','medcard:create','medcard:edit','medcard:sign',
    'lab:view','lab:order','lab:enter_results','lab:verify',
    'analytics:view',
    'tasks:view','tasks:create','tasks:edit'
  );

  -- NURSE — расписание всех, базовая работа с пациентом, склад на просмотр.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_nurse, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:create','patients:edit',
    'crm:view',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit',
    'visit:view','visit:create','visit:edit',
    'medcard:view',
    'lab:view','lab:order',
    'inventory:view',
    'tasks:view','tasks:create','tasks:edit'
  );

  -- LABORANT — лаборатория + свой склад реагентов целиком.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_laborant, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view',
    'lab:view','lab:enter_results','lab:verify',
    'inventory:view','inventory:create','inventory:writeoff',
    'tasks:view','tasks:edit'
  );

  -- CASHIER — касса, видит расписание/визиты для биллинга, может править
  -- ошибочные платежи и делать возвраты. Без approve_discount.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_cashier, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view',
    'schedule:view','schedule:view_all',
    'visit:view',
    'finance:view','finance:create','finance:edit','finance:refund','finance:reports','finance:cash_session',
    'tasks:view'
  );

  -- MANAGER — CRM end-to-end: ведёт сделки, видит расписание/визит/деньги
  -- по своим лидам, аналитику воронки. Медкарта закрыта.
  INSERT INTO role_permissions(role_id, permission_id)
  SELECT r_manager, id FROM permissions
  WHERE (module || ':' || action) IN (
    'patients:view','patients:create','patients:edit','patients:merge','patients:export',
    'crm:view','crm:create','crm:edit','crm:delete',
    'schedule:view','schedule:view_all','schedule:create','schedule:edit',
    'visit:view',
    'finance:view',
    'analytics:view','analytics:export',
    'tasks:view','tasks:create','tasks:edit'
  );

END; $$;

-- ============================================================
-- Применяем новые дефолты к УЖЕ СУЩЕСТВУЮЩИМ системным ролям
-- (по всем клиникам). Кастомные (is_system=false) не трогаем.
-- ============================================================

DO $$
DECLARE
  c_id UUID;
BEGIN
  FOR c_id IN
    SELECT DISTINCT clinic_id FROM roles WHERE is_system = true
  LOOP
    -- seed_clinic_roles() сам подчищает старые гранты системных ролей.
    PERFORM seed_clinic_roles(c_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
