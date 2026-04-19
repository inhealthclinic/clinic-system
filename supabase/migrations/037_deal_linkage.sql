-- ============================================================
-- 037_deal_linkage.sql — связь CRM-сделок с визитами/приёмами/деньгами
--
-- ТЗ: сделка (deal) → приём (appointment) → визит (visit) →
--     начисление (charge) → оплата (payment).
-- Всё это пациенто-центрично и должно быть прослеживаемо.
--
-- Добавляем необязательный deal_id на appointments / visits / charges,
-- представление v_deal_journey для KPI (визиты/деньги/долг по сделке),
-- best-effort backfill по (patient_id + clinic_id + близость дат).
-- ============================================================

-- 1. FK-колонки
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='appointments' AND column_name='deal_id') THEN
    ALTER TABLE appointments ADD COLUMN deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='visits' AND column_name='deal_id') THEN
    ALTER TABLE visits ADD COLUMN deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='charges' AND column_name='deal_id') THEN
    ALTER TABLE charges ADD COLUMN deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_deal ON appointments(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visits_deal       ON visits(deal_id)       WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charges_deal      ON charges(deal_id)      WHERE deal_id IS NOT NULL;

-- 2. Триггер: визит наследует deal_id от appointment (если задан)
CREATE OR REPLACE FUNCTION fn_visit_inherit_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deal_id IS NULL AND NEW.appointment_id IS NOT NULL THEN
    SELECT deal_id INTO NEW.deal_id FROM appointments WHERE id = NEW.appointment_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_visit_inherit_deal ON visits;
CREATE TRIGGER trg_visit_inherit_deal
  BEFORE INSERT OR UPDATE OF appointment_id ON visits
  FOR EACH ROW EXECUTE FUNCTION fn_visit_inherit_deal();

-- 3. Триггер: charge наследует deal_id от visit (если задан)
CREATE OR REPLACE FUNCTION fn_charge_inherit_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deal_id IS NULL AND NEW.visit_id IS NOT NULL THEN
    SELECT deal_id INTO NEW.deal_id FROM visits WHERE id = NEW.visit_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_charge_inherit_deal ON charges;
CREATE TRIGGER trg_charge_inherit_deal
  BEFORE INSERT OR UPDATE OF visit_id ON charges
  FOR EACH ROW EXECUTE FUNCTION fn_charge_inherit_deal();

-- 4. Триггер: при INSERT в appointments с deal_id
--    и если у сделки ещё нет booked_at — стадия "Записан" (booked-role)
CREATE OR REPLACE FUNCTION fn_appointment_advance_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_booked_stage_id UUID;
  v_current_role TEXT;
BEGIN
  IF NEW.deal_id IS NULL THEN RETURN NEW; END IF;

  -- Находим первый stage с ролью 'won' в воронке сделки (в leads это 'booked')
  SELECT s.id INTO v_booked_stage_id
    FROM deals d
    JOIN pipeline_stages s ON s.pipeline_id = d.pipeline_id
   WHERE d.id = NEW.deal_id
     AND s.stage_role = 'won'
     AND s.is_active = true
   ORDER BY s.sort_order ASC
   LIMIT 1;

  IF v_booked_stage_id IS NULL THEN RETURN NEW; END IF;

  -- Не двигаем, если сделка уже в won/lost/closed
  SELECT ps.stage_role INTO v_current_role
    FROM deals d
    JOIN pipeline_stages ps ON ps.id = d.stage_id
   WHERE d.id = NEW.deal_id;

  IF v_current_role IN ('won','lost','closed') THEN RETURN NEW; END IF;

  UPDATE deals SET stage_id = v_booked_stage_id WHERE id = NEW.deal_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_appointment_advance_deal ON appointments;
CREATE TRIGGER trg_appointment_advance_deal
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_appointment_advance_deal();

-- 5. Best-effort backfill:
--    Сделка ↔ ближайшее по времени appointment того же пациента
--    (в пределах 30 дней) — только если deal.patient_id задан и нет конфликтов.
UPDATE appointments a
   SET deal_id = d.id
  FROM deals d
 WHERE a.deal_id IS NULL
   AND d.patient_id IS NOT NULL
   AND a.patient_id = d.patient_id
   AND a.clinic_id  = d.clinic_id
   AND (a.date + a.time_start)::TIMESTAMP
         BETWEEN d.created_at - INTERVAL '7 days'
             AND d.created_at + INTERVAL '30 days';

-- Визиты подтянутся через trg_visit_inherit_deal при следующем UPDATE,
-- но для исторических сделаем прямой backfill:
UPDATE visits v
   SET deal_id = a.deal_id
  FROM appointments a
 WHERE v.deal_id IS NULL
   AND v.appointment_id = a.id
   AND a.deal_id IS NOT NULL;

UPDATE charges c
   SET deal_id = v.deal_id
  FROM visits v
 WHERE c.deal_id IS NULL
   AND c.visit_id = v.id
   AND v.deal_id IS NOT NULL;

-- 6. KPI view: v_deal_journey — визиты/деньги/долг по каждой сделке
DROP VIEW IF EXISTS v_deal_journey;
CREATE VIEW v_deal_journey AS
WITH
  appt_agg AS (
    SELECT deal_id, COUNT(*) AS appointments_count
      FROM appointments
     WHERE deal_id IS NOT NULL
     GROUP BY deal_id
  ),
  visit_agg AS (
    SELECT deal_id,
           COUNT(*)                                       AS visits_count,
           COUNT(*) FILTER (WHERE status = 'completed')   AS visits_completed
      FROM visits
     WHERE deal_id IS NOT NULL
     GROUP BY deal_id
  ),
  charge_agg AS (
    SELECT deal_id, SUM(amount) AS charges_total
      FROM charges
     WHERE deal_id IS NOT NULL
     GROUP BY deal_id
  ),
  payment_agg AS (
    SELECT c.deal_id,
           SUM(p.amount) FILTER (WHERE p.type IN ('payment','prepayment')) AS payments_total,
           SUM(p.amount) FILTER (WHERE p.type = 'refund')                  AS refunds_total
      FROM payments p
      JOIN charges c ON c.id = p.charge_id
     WHERE c.deal_id IS NOT NULL
     GROUP BY c.deal_id
  )
SELECT
  d.id                                             AS deal_id,
  d.clinic_id,
  d.pipeline_id,
  d.stage_id,
  d.patient_id,
  d.name                                           AS deal_name,
  d.amount                                         AS deal_amount,
  d.status                                         AS deal_status,
  d.created_at                                     AS deal_created_at,
  COALESCE(a.appointments_count, 0)                AS appointments_count,
  COALESCE(v.visits_count, 0)                      AS visits_count,
  COALESCE(v.visits_completed, 0)                  AS visits_completed,
  COALESCE(c.charges_total, 0)::DECIMAL(12,2)      AS charges_total,
  COALESCE(p.payments_total, 0)::DECIMAL(12,2)     AS payments_total,
  COALESCE(p.refunds_total, 0)::DECIMAL(12,2)      AS refunds_total
FROM deals d
LEFT JOIN appt_agg    a ON a.deal_id = d.id
LEFT JOIN visit_agg   v ON v.deal_id = d.id
LEFT JOIN charge_agg  c ON c.deal_id = d.id
LEFT JOIN payment_agg p ON p.deal_id = d.id
WHERE d.deleted_at IS NULL;

GRANT SELECT ON v_deal_journey TO authenticated;

NOTIFY pgrst, 'reload schema';
