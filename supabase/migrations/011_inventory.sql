-- ============================================================
-- 011_inventory.sql
-- Склад: реагенты, расходники, партии, движения, шаблоны списания
-- ============================================================

CREATE TABLE reagents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  name       TEXT NOT NULL,
  code       TEXT,
  unit       TEXT NOT NULL,
  min_stock  DECIMAL(10,3) NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consumables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  name       TEXT NOT NULL,
  code       TEXT,
  unit       TEXT NOT NULL,
  min_stock  DECIMAL(10,3) NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Партии (FEFO: first expired, first out)
CREATE TABLE inventory_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id),
  item_type    TEXT NOT NULL CHECK (item_type IN ('reagent','consumable')),
  item_id      UUID NOT NULL,
  batch_number TEXT,
  quantity     DECIMAL(10,3) NOT NULL,
  remaining    DECIMAL(10,3) NOT NULL,
  unit_cost    DECIMAL(10,2),
  expires_at   DATE,
  received_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by  UUID REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Движения склада
CREATE TABLE inventory_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  batch_id      UUID NOT NULL REFERENCES inventory_batches(id),
  item_type     TEXT NOT NULL,
  item_id       UUID NOT NULL,
  type          TEXT NOT NULL CHECK (type IN (
    'incoming','writeoff_service','writeoff_lab',
    'damaged','expired','correction','return'
  )),
  quantity      DECIMAL(10,3) NOT NULL,
  visit_id      UUID REFERENCES visits(id),
  lab_order_id  UUID REFERENCES lab_orders(id),
  charge_id     UUID REFERENCES charges(id),
  reason        TEXT,
  is_manual     BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Шаблон списания для услуги
CREATE TABLE service_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL CHECK (item_type IN ('reagent','consumable')),
  item_id    UUID NOT NULL,
  qty        DECIMAL(10,3) NOT NULL
);

-- FEFO: функция автосписания при оплате услуги
CREATE OR REPLACE FUNCTION auto_writeoff_inventory(
  p_charge_id  UUID,
  p_clinic_id  UUID,
  p_service_id UUID,
  p_visit_id   UUID,
  p_user_id    UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  tmpl  RECORD;
  batch RECORD;
  need  DECIMAL(10,3);
BEGIN
  FOR tmpl IN
    SELECT * FROM service_templates WHERE service_id = p_service_id
  LOOP
    need := tmpl.qty;
    -- FEFO: партии по возрастанию expires_at
    FOR batch IN
      SELECT * FROM inventory_batches
      WHERE item_type = tmpl.item_type
        AND item_id   = tmpl.item_id
        AND clinic_id = p_clinic_id
        AND remaining > 0
      ORDER BY COALESCE(expires_at, '9999-12-31'), created_at
    LOOP
      EXIT WHEN need <= 0;
      DECLARE used DECIMAL(10,3) := LEAST(need, batch.remaining);
      BEGIN
        UPDATE inventory_batches SET remaining = remaining - used WHERE id = batch.id;
        INSERT INTO inventory_movements(
          clinic_id, batch_id, item_type, item_id, type,
          quantity, visit_id, charge_id, created_by
        ) VALUES(
          p_clinic_id, batch.id, tmpl.item_type, tmpl.item_id,
          'writeoff_service', used, p_visit_id, p_charge_id, p_user_id
        );
        need := need - used;
      END;
    END LOOP;
  END LOOP;
END; $$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE reagents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_templates    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reagents: own clinic"            ON reagents            FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "consumables: own clinic"         ON consumables         FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "inventory_batches: own clinic"   ON inventory_batches   FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "inventory_movements: own clinic" ON inventory_movements FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "service_templates: read"         ON service_templates   FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE INDEX idx_batches_fefo      ON inventory_batches(item_type, item_id, clinic_id, expires_at) WHERE remaining > 0;
CREATE INDEX idx_batches_low_stock ON inventory_batches(clinic_id, item_type, item_id);
CREATE INDEX idx_movements_clinic  ON inventory_movements(clinic_id, created_at DESC);
CREATE INDEX idx_movements_visit   ON inventory_movements(visit_id);
