-- ============================================================
-- 015_visit_services_payments.sql
-- Услуги визита (snapshot цены), способы оплаты,
-- + колонки учёта оплаты в visits
-- ============================================================

-- ── Способы оплаты (справочник клиники) ──────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  method_code TEXT NOT NULL DEFAULT 'cash'
                CHECK (method_code IN ('cash','kaspi','halyk','credit','balance')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, name)
);

-- ── Услуги визита (цена фиксируется на момент записи) ────────
CREATE TABLE IF NOT EXISTS visit_services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id            UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  service_id          UUID REFERENCES services(id),
  name                TEXT NOT NULL,
  quantity            INT NOT NULL DEFAULT 1,
  price_at_booking    DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_at_booking INT NOT NULL DEFAULT 30,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Добавить колонки учёта оплаты в visits ───────────────────
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS total_price    DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid     DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid'));

-- ── Добавить visit_id в payments для связки на уровне визита ─
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES visits(id);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_services  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_methods: own clinic" ON payment_methods
  FOR ALL USING (clinic_id = current_clinic_id());

CREATE POLICY "visit_services: own clinic" ON visit_services
  FOR ALL USING (
    visit_id IN (SELECT id FROM visits WHERE clinic_id = current_clinic_id())
  );

-- ── Индексы ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_methods_clinic
  ON payment_methods(clinic_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_visit_services_visit
  ON visit_services(visit_id);

CREATE INDEX IF NOT EXISTS idx_payments_visit
  ON payments(visit_id);
