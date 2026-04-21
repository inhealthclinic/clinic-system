-- ============================================================
-- 043_sync_patient_balance_amount.sql
--
-- Цель: починить отображение предоплаты в карточке пациента.
--
-- Контекст: триггер recalc_patient_balance() из 009_finance.sql писал
-- пополнение предоплаты в отдельную таблицу patient_balance.balance,
-- но UI (patients/[id]/finance, patients, schedule drawer) читает
-- patients.balance_amount — колонку, которая никогда не обновлялась
-- и всегда оставалась 0.
--
-- Решение: patient_balance остаётся источником правды (там же ведутся
-- balance_movements для аудита), а patients.balance_amount превращается
-- в кэш/зеркало balance — его обновляет тот же триггер после каждой
-- операции. Дополнительно делаем разовый бэкфилл для уже накопленных
-- данных и фиксируем merge_patients, чтобы после слияния balance_amount
-- тоже подтягивался.
-- ============================================================

-- 1) Новая версия триггер-функции: всё как было + в конце UPDATE patients.balance_amount
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
    -- Зеркалим депозит в patients.balance_amount, чтобы UI видел его
    -- везде, где уже читает эту колонку (карточка, список пациентов,
    -- drawer расписания, /finance).
    balance_amount = COALESCE(
      (SELECT balance FROM patient_balance WHERE patient_id = NEW.patient_id),
      0
    ),
    updated_at = now()
  WHERE id = NEW.patient_id;

  RETURN NEW;
END; $$;

-- 2) Разовый бэкфилл: подтянуть balance_amount из существующих patient_balance.
--    Пациенты без строки в patient_balance и так уже имеют balance_amount=0
--    (DEFAULT из 003_patients.sql), их трогать не нужно.
UPDATE patients p SET
  balance_amount = pb.balance,
  updated_at     = now()
FROM patient_balance pb
WHERE p.id = pb.patient_id
  AND p.balance_amount IS DISTINCT FROM pb.balance;

-- 3) Страховка на будущее: если кто-то пишет в patient_balance напрямую
--    (например, merge_patients в 003_patients.sql), balance_amount всё
--    равно синхронизируется через отдельный триггер на patient_balance.
CREATE OR REPLACE FUNCTION sync_patient_balance_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient_id UUID;
BEGIN
  v_patient_id := COALESCE(NEW.patient_id, OLD.patient_id);
  IF v_patient_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE patients SET
    balance_amount = COALESCE(
      (SELECT balance FROM patient_balance WHERE patient_id = v_patient_id),
      0
    ),
    updated_at = now()
  WHERE id = v_patient_id;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_sync_balance_amount ON patient_balance;
CREATE TRIGGER trg_sync_balance_amount
  AFTER INSERT OR UPDATE OR DELETE ON patient_balance
  FOR EACH ROW EXECUTE FUNCTION sync_patient_balance_amount();
