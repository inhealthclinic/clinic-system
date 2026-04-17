-- ============================================================
-- 012_salary.sql
-- Зарплата и комиссия врачей
-- ============================================================

CREATE TABLE doctor_salary_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  doctor_id      UUID NOT NULL REFERENCES doctors(id) UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('fixed','percent','mixed')),
  fixed_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  percent_rate   DECIMAL(5,2)  NOT NULL DEFAULT 0,
  plan_amount    DECIMAL(10,2),   -- план для mixed
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID REFERENCES user_profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE doctor_payroll (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id),
  doctor_id      UUID NOT NULL REFERENCES doctors(id),
  period_from    DATE NOT NULL,
  period_to      DATE NOT NULL,
  visits_count   INT NOT NULL DEFAULT 0,
  revenue_total  DECIMAL(10,2) NOT NULL DEFAULT 0,
  fixed_part     DECIMAL(10,2) NOT NULL DEFAULT 0,
  percent_part   DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_earned   DECIMAL(10,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','paid')),
  approved_by    UUID REFERENCES user_profiles(id),
  approved_at    TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VIEW: выручка врача за период (для расчёта)
CREATE OR REPLACE VIEW doctor_revenue_summary AS
SELECT
  d.clinic_id,
  d.id   AS doctor_id,
  d.first_name || ' ' || d.last_name AS doctor_name,
  COUNT(DISTINCT v.id) AS visits_count,
  COALESCE(SUM(c.total - c.discount), 0) AS revenue
FROM doctors d
LEFT JOIN visits v ON v.doctor_id = d.id
LEFT JOIN charges c ON c.visit_id = v.id AND c.status = 'paid'
GROUP BY d.clinic_id, d.id, doctor_name;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE doctor_salary_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_payroll         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_salary: own clinic" ON doctor_salary_settings FOR ALL USING (clinic_id = current_clinic_id());
CREATE POLICY "doctor_payroll: own clinic" ON doctor_payroll        FOR ALL USING (clinic_id = current_clinic_id());

CREATE INDEX idx_payroll_doctor  ON doctor_payroll(doctor_id, period_from DESC);
CREATE INDEX idx_payroll_clinic  ON doctor_payroll(clinic_id, status);
