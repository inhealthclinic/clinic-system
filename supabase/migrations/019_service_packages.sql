-- ============================================================
-- 019_service_packages.sql
-- Пакеты услуг (чек-апы, панели). Используется как shortcut в UI
-- — клик по пакету отмечает все его услуги. В visit_services
-- каждая услуга добавляется отдельной строкой со своей ценой.
-- ============================================================

CREATE TABLE IF NOT EXISTS service_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price       DECIMAL(10,2),            -- NULL = сумма услуг пакета
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_package_items (
  package_id UUID NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id)         ON DELETE CASCADE,
  PRIMARY KEY (package_id, service_id)
);

ALTER TABLE service_packages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage service_packages"
  ON service_packages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Auth manage service_package_items"
  ON service_package_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_service_packages_clinic
  ON service_packages(clinic_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_service_package_items_package
  ON service_package_items(package_id);

-- ── Сид: 5 готовых пакетов ──────────────────────────────────
-- Каждому пакету передаём массив названий услуг. Запрос найдёт
-- их по имени в каждой клинике и свяжет. Идемпотентно: ON CONFLICT.

WITH pkg_defs(name, sort_order, svc_names) AS (
  VALUES
    (
      'Чекап: Анемия', 10,
      ARRAY['ОАК+СОЭ','Ферритин','Железо','Витамин B12','B9 (фолиевая кислота)','Гомоцистеин']
    ),
    (
      'Чекап: Щитовидная железа', 20,
      ARRAY['ТТГ','Т3 свободный','Т4 свободный','Анти-ТГ','Анти-ТПО']
    ),
    (
      'Чекап: Женское здоровье', 30,
      ARRAY['ЛГ','ФСГ','Эстрадиол','Пролактин','Прогестерон','Тестостерон','ДГЭА','ТТГ']
    ),
    (
      'Чекап: Диабет-контроль', 40,
      ARRAY['Глюкоза','Гликиров. гемоглобин','Инсулин']
    ),
    (
      'Биохимия расширенная', 50,
      ARRAY['АЛТ','АСТ','Билирубин общ','Общий белок','Альбумин','Креатинин','Мочевина','Глюкоза','Холестерин общ','Триглицериды','ГГТ','Щелочная фосфатаза']
    )
),
-- Создаём пакеты в каждой клинике (если такого ещё нет)
inserted_pkgs AS (
  INSERT INTO service_packages (clinic_id, name, sort_order)
  SELECT c.id, d.name, d.sort_order
  FROM clinics c
  CROSS JOIN pkg_defs d
  WHERE NOT EXISTS (
    SELECT 1 FROM service_packages p
    WHERE p.clinic_id = c.id AND LOWER(p.name) = LOWER(d.name)
  )
  RETURNING id, clinic_id, name
),
-- Собираем все нужные связи для вставленных пакетов
all_pkgs AS (
  SELECT p.id, p.clinic_id, p.name
  FROM service_packages p
)
-- Привязываем услуги по имени (для ВСЕХ пакетов — идемпотентно)
INSERT INTO service_package_items (package_id, service_id)
SELECT DISTINCT p.id, s.id
FROM all_pkgs p
JOIN pkg_defs d ON LOWER(d.name) = LOWER(p.name)
JOIN LATERAL unnest(d.svc_names) AS svc_name ON true
JOIN services s
  ON s.clinic_id = p.clinic_id
 AND LOWER(s.name) = LOWER(svc_name)
 AND s.is_lab = true
ON CONFLICT (package_id, service_id) DO NOTHING;
