-- ============================================================
-- 019_service_packages.sql
-- Пакеты услуг (чек-апы, панели). Используется как shortcut в UI
-- — клик по пакету отмечает все его услуги. В visit_services
-- каждая услуга добавляется отдельной строкой со своей ценой.
--
-- Защитный вариант: обрабатывает случай, когда service_packages
-- уже была создана ранее без части колонок (ошибка 42703
-- "column sort_order does not exist").
-- ============================================================

-- 1) Таблицы (если их нет)
CREATE TABLE IF NOT EXISTS service_packages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_package_items (
  package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id)         ON DELETE CASCADE,
  PRIMARY KEY (package_id, service_id)
);

-- 2) Добиваем недостающие колонки, если таблица уже была
ALTER TABLE service_packages
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS price       DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) RLS
ALTER TABLE service_packages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth manage service_packages"      ON service_packages;
DROP POLICY IF EXISTS "Auth manage service_package_items" ON service_package_items;

CREATE POLICY "Auth manage service_packages"
  ON service_packages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage service_package_items"
  ON service_package_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4) Индексы
CREATE INDEX IF NOT EXISTS idx_service_packages_clinic
  ON service_packages(clinic_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_service_package_items_package
  ON service_package_items(package_id);

-- 5) Сид: 5 готовых пакетов в каждой клинике
WITH pkg_defs(name, sort_order, svc_names) AS (
  VALUES
    ('Чекап: Анемия', 10,
      ARRAY['ОАК+СОЭ','Ферритин','Железо','Витамин B12','B9 (фолиевая кислота)','Гомоцистеин']),
    ('Чекап: Щитовидная железа', 20,
      ARRAY['ТТГ','Т3 свободный','Т4 свободный','Анти-ТГ','Анти-ТПО']),
    ('Чекап: Женское здоровье', 30,
      ARRAY['ЛГ','ФСГ','Эстрадиол','Пролактин','Прогестерон','Тестостерон','ДГЭА','ТТГ']),
    ('Чекап: Диабет-контроль', 40,
      ARRAY['Глюкоза','Гликиров. гемоглобин','Инсулин']),
    ('Биохимия расширенная', 50,
      ARRAY['АЛТ','АСТ','Билирубин общ','Общий белок','Альбумин','Креатинин','Мочевина',
            'Глюкоза','Холестерин общ','Триглицериды','ГГТ','Щелочная фосфатаза'])
),
inserted_pkgs AS (
  INSERT INTO service_packages (clinic_id, name, sort_order)
  SELECT c.id, d.name, d.sort_order
  FROM clinics c
  CROSS JOIN pkg_defs d
  WHERE NOT EXISTS (
    SELECT 1 FROM service_packages p
    WHERE p.clinic_id = c.id AND LOWER(p.name) = LOWER(d.name)
  )
  RETURNING id
)
INSERT INTO service_package_items (package_id, service_id)
SELECT DISTINCT p.id, s.id
FROM service_packages p
JOIN pkg_defs d ON LOWER(d.name) = LOWER(p.name)
JOIN LATERAL unnest(d.svc_names) AS svc_name ON true
JOIN services s
  ON s.clinic_id = p.clinic_id
 AND LOWER(s.name) = LOWER(svc_name)
 AND s.is_lab = true
WHERE NOT EXISTS (
  SELECT 1 FROM service_package_items i
  WHERE i.package_id = p.id AND i.service_id = s.id
);
