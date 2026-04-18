-- ============================================================
-- 030_service_inventory_usage.sql — шаблон списания расходников + авто-списание по заказу
-- Таблица шаблонов (услуга → реагент/расходник × qty), FEFO-функция,
-- триггер при переходе lab_orders.status → 'sample_taken', идемпотентность,
-- RLS, аудит.
-- Идемпотентно (можно прогонять повторно).
-- ============================================================

-- 1) Таблица шаблона списания
CREATE TABLE IF NOT EXISTS service_inventory_usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_type        TEXT NOT NULL CHECK (item_type IN ('reagent','consumable')),
  item_id          UUID NOT NULL,
  qty_per_service  DECIMAL(10,3) NOT NULL CHECK (qty_per_service > 0),
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Не допускаем дубликатов строк (услуга × тип × конкретный реагент/расходник)
DO $uq$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_inventory_usage_unique'
  ) THEN
    ALTER TABLE service_inventory_usage
      ADD CONSTRAINT service_inventory_usage_unique
      UNIQUE (service_id, item_type, item_id);
  END IF;
END
$uq$;

CREATE INDEX IF NOT EXISTS idx_siu_service  ON service_inventory_usage(service_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_siu_clinic   ON service_inventory_usage(clinic_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_siu_updated_at ON service_inventory_usage;
CREATE TRIGGER trg_siu_updated_at
BEFORE UPDATE ON service_inventory_usage
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Идемпотентность авто-списания
ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS auto_writeoff_at TIMESTAMPTZ;

-- 3) FEFO-функция: списывает расходники по всем items заказа
CREATE OR REPLACE FUNCTION fn_lab_order_auto_writeoff(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_order       lab_orders%ROWTYPE;
  v_item        RECORD;
  v_tmpl        RECORD;
  v_batch       RECORD;
  v_need        DECIMAL(10,3);
  v_used        DECIMAL(10,3);
BEGIN
  SELECT * INTO v_order FROM lab_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Идемпотентность: не списывать повторно
  IF v_order.auto_writeoff_at IS NOT NULL THEN RETURN; END IF;
  IF v_order.clinic_id IS NULL THEN RETURN; END IF;

  FOR v_item IN
    SELECT id, service_id FROM lab_order_items WHERE order_id = p_order_id
  LOOP
    IF v_item.service_id IS NULL THEN CONTINUE; END IF;

    FOR v_tmpl IN
      SELECT item_type, item_id, qty_per_service
      FROM service_inventory_usage
      WHERE service_id = v_item.service_id
        AND clinic_id  = v_order.clinic_id
        AND is_active  = true
    LOOP
      v_need := v_tmpl.qty_per_service;

      FOR v_batch IN
        SELECT id, quantity_remaining
        FROM inventory_batches
        WHERE item_type = v_tmpl.item_type
          AND item_id   = v_tmpl.item_id
          AND clinic_id = v_order.clinic_id
          AND is_active = true
          AND quantity_remaining > 0
        ORDER BY COALESCE(expires_at, '9999-12-31'), created_at
      LOOP
        EXIT WHEN v_need <= 0;
        v_used := LEAST(v_need, v_batch.quantity_remaining);

        UPDATE inventory_batches
           SET quantity_remaining = quantity_remaining - v_used
         WHERE id = v_batch.id;

        INSERT INTO inventory_movements(
          clinic_id, batch_id, item_type, item_id, type,
          quantity, lab_order_id, notes
        ) VALUES (
          v_order.clinic_id, v_batch.id, v_tmpl.item_type, v_tmpl.item_id,
          'writeoff_lab', v_used, p_order_id,
          'Авто-списание по забору образца'
        );

        v_need := v_need - v_used;
      END LOOP;
      -- если v_need > 0 — недостача на складе, пропускаем (не падаем),
      -- UI подсветит оранжевой плашкой на экране инвентаря
    END LOOP;
  END LOOP;

  UPDATE lab_orders SET auto_writeoff_at = now() WHERE id = p_order_id;
END
$fn$;

-- 4) Триггер на lab_orders: status меняется на 'sample_taken'
CREATE OR REPLACE FUNCTION fn_lab_orders_auto_writeoff_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'sample_taken'
     AND COALESCE(OLD.status,'') <> 'sample_taken'
     AND NEW.auto_writeoff_at IS NULL
  THEN
    PERFORM fn_lab_order_auto_writeoff(NEW.id);
  END IF;
  RETURN NEW;
END
$trg$;

DROP TRIGGER IF EXISTS trg_lab_orders_auto_writeoff ON lab_orders;
CREATE TRIGGER trg_lab_orders_auto_writeoff
AFTER UPDATE OF status ON lab_orders
FOR EACH ROW EXECUTE FUNCTION fn_lab_orders_auto_writeoff_trg();

-- 5) RLS (клиника видит только свои шаблоны)
ALTER TABLE service_inventory_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "siu_clinic_scope" ON service_inventory_usage;
CREATE POLICY "siu_clinic_scope"
  ON service_inventory_usage FOR ALL
  TO authenticated
  USING (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  );

-- 6) Audit trigger — шаблоны критичны (влияют на себестоимость)
DROP TRIGGER IF EXISTS trg_audit_service_inventory_usage ON service_inventory_usage;
CREATE TRIGGER trg_audit_service_inventory_usage
AFTER INSERT OR UPDATE OR DELETE ON service_inventory_usage
FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

NOTIFY pgrst, 'reload schema';
