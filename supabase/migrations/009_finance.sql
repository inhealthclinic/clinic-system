-- ============================================================
-- 009_finance.sql
-- Финансы: начисления, оплаты, депозит, кассовые смены
-- ============================================================

-- ============================================================
-- CASH SESSIONS (кассовые смены)
-- ============================================================
CREATE TABLE cash_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id),
  opened_by     UUID NOT NULL REFERENCES user_profiles(id),
  closed_by     UUID REFERENCES user_profiles(id),
  opening_cash  DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_cash  DECIMAL(10,2),
  expected_cash DECIMAL(10,2),
  difference    DECIMAL(10,2),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  notes         TEXT
);

-- ============================================================
-- CHARGES (начисления — уровень 1)
-- ============================================================
CREATE TABLE charges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID NOT NULL REFERENCES clinics(id),
  visit_id             UUID REFERENCES visits(id),
  patient_id           UUID NOT NULL REFERENCES patients(id),
  service_id           UUID REFERENCES services(id),
  lab_item_id          UUID REFERENCES lab_order_items(id),
  name                 TEXT NOT NULL,
  quantity             INT NOT NULL DEFAULT 1,
  unit_price           DECIMAL(10,2) NOT NULL,
  discount             DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                DECIMAL(10,2) NOT NULL,
  -- Скидки
  discount_approved_by UUID REFERENCES user_profiles(id),
  discount_reason      TEXT,
  -- Статус
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','pending_approval','paid','partial','cancelled')),
  -- Процедура (для медсестры)
  procedure_status     TEXT NOT NULL DEFAULT 'pending'
                         CHECK (procedure_status IN ('pending','in_progress','done')),
  performed_by         UUID REFERENCES user_profiles(id),
  performed_at         TIMESTAMPTZ,
  -- Мета
  created_by           UUID REFERENCES user_profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_charges_updated_at
  BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- При добавлении charge → visit.has_charges = true
CREATE OR REPLACE FUNCTION update_visit_has_charges()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visit_id IS NOT NULL THEN
    UPDATE visits SET has_charges = true WHERE id = NEW.visit_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_visit_has_charges
  AFTER INSERT ON charges
  FOR EACH ROW EXECUTE FUNCTION update_visit_has_charges();

-- ============================================================
-- PATIENT BALANCE (депозит — уровень 3)
-- ============================================================
CREATE TABLE patient_balance (
  patient_id UUID PRIMARY KEY REFERENCES patients(id),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  balance    DECIMAL(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE balance_movements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  type       TEXT NOT NULL CHECK (type IN ('topup','deduct','refund')),
  amount     DECIMAL(10,2) NOT NULL,
  payment_id UUID,    -- FK добавится после создания payments
  charge_id  UUID REFERENCES charges(id),
  notes      TEXT,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PAYMENTS (оплаты — уровень 2)
-- ============================================================
CREATE TABLE payments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                  UUID NOT NULL REFERENCES clinics(id),
  charge_id                  UUID REFERENCES charges(id),
  patient_id                 UUID NOT NULL REFERENCES patients(id),
  session_id                 UUID REFERENCES cash_sessions(id),
  amount                     DECIMAL(10,2) NOT NULL,
  method                     TEXT NOT NULL
                               CHECK (method IN ('cash','kaspi','halyk','credit','balance')),
  type                       TEXT NOT NULL
                               CHECK (type IN ('payment','prepayment','refund','writeoff')),
  refund_reason              TEXT,  -- обязателен при type=refund
  reference                  TEXT,
  notes                      TEXT,
  -- Подтверждение возврата наличными
  cash_refund_confirmed_by   UUID REFERENCES user_profiles(id),
  cash_refund_confirmed_at   TIMESTAMPTZ,
  -- Статус
  status                     TEXT NOT NULL DEFAULT 'completed'
                               CHECK (status IN ('pending_confirmation','completed','failed')),
  received_by                UUID REFERENCES user_profiles(id),
  paid_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK balance_movements → payments
ALTER TABLE balance_movements
  ADD CONSTRAINT fk_balance_payment
  FOREIGN KEY (payment_id) REFERENCES payments(id);

-- После оплаты: пересчитать баланс/долг пациента
CREATE OR REPLACE FUNCTION recalc_patient_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Пополнение депозита
  IF NEW.type = 'prepayment' AND NEW.status = 'completed' THEN
    INSERT INTO patient_balance(patient_id, clinic_id, balance)
    VALUES(NEW.patient_id, NEW.clinic_id, NEW.amount)
    ON CONFLICT (patient_id) DO UPDATE
      SET balance = patient_balance.balance + NEW.amount;
    INSERT INTO balance_movements(clinic_id, patient_id, type, amount, payment_id, created_by)
    VALUES(NEW.clinic_id, NEW.patient_id, 'topup', NEW.amount, NEW.id, NEW.received_by);
  END IF;

  -- Списание с депозита
  IF NEW.method = 'balance' AND NEW.type = 'payment' AND NEW.status = 'completed' THEN
    UPDATE patient_balance SET balance = balance - NEW.amount
    WHERE patient_id = NEW.patient_id;
    INSERT INTO balance_movements(clinic_id, patient_id, type, amount, payment_id, charge_id, created_by)
    VALUES(NEW.clinic_id, NEW.patient_id, 'deduct', NEW.amount, NEW.id, NEW.charge_id, NEW.received_by);
  END IF;

  -- Пересчёт долга пациента
  UPDATE patients SET
    debt_amount = COALESCE((
      SELECT SUM(c.total - c.discount) - COALESCE(SUM(p2.amount) FILTER (WHERE p2.type = 'payment'), 0)
      FROM charges c
      LEFT JOIN payments p2 ON p2.charge_id = c.id AND p2.status = 'completed'
      WHERE c.patient_id = NEW.patient_id AND c.status IN ('pending','partial')
    ), 0),
    updated_at = now()
  WHERE id = NEW.patient_id;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_recalc_balance
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION recalc_patient_balance();

-- После оплаты → списать склад + обновить visit.finance_settled
CREATE OR REPLACE FUNCTION on_charge_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
    -- Проверить все charges визита — если все paid → visit.finance_settled = true
    IF NEW.visit_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM charges
      WHERE visit_id = NEW.visit_id AND status NOT IN ('paid','cancelled')
    ) THEN
      UPDATE visits SET finance_settled = true WHERE id = NEW.visit_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_charge_paid
  AFTER UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION on_charge_paid();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE cash_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE charges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_balance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_sessions: own clinic"    ON cash_sessions     FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "charges: own clinic"          ON charges           FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "payments: own clinic"         ON payments          FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "patient_balance: own clinic"  ON patient_balance   FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "balance_movements: own clinic" ON balance_movements FOR ALL USING (clinic_id = current_clinic_id());

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_charges_visit    ON charges(visit_id);
CREATE INDEX idx_charges_patient  ON charges(patient_id, created_at DESC);
CREATE INDEX idx_charges_status   ON charges(clinic_id, status);
CREATE INDEX idx_charges_pending_approval ON charges(clinic_id) WHERE status = 'pending_approval';
CREATE INDEX idx_payments_patient ON payments(patient_id, paid_at DESC);
CREATE INDEX idx_payments_session ON payments(session_id);
CREATE INDEX idx_payments_clinic  ON payments(clinic_id, paid_at DESC);
CREATE INDEX idx_balance_patient  ON balance_movements(patient_id, created_at DESC);
