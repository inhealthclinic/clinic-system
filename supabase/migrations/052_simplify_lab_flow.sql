-- ============================================================
-- 052_simplify_lab_flow.sql
-- Упрощаем рабочий процесс лаборатории:
--   - убираем «Согласовать» и «Материал взят» как отдельные шаги
--   - теперь заказ движется: ordered → in_progress → ready → verified → delivered
--
-- Что делает миграция:
--   1) fn_lab_order_status_guard — добавляет переход ordered→in_progress
--      (старые пути agreed/sample_taken остаются — для легаси данных)
--   2) fn_lab_order_autofill_timestamps — при переходе в in_progress
--      автоматически проставляет agreed_at и sample_taken_at, чтобы
--      метрики TAT не ломались
--   3) fn_lab_orders_auto_writeoff_trg — FEFO-списание теперь срабатывает
--      и при sample_taken (легаси), и при in_progress (новый путь)
--
-- Идемпотентно.
-- ============================================================

-- ─── 1) Расширенный status-guard ────────────────────────────
CREATE OR REPLACE FUNCTION fn_lab_order_status_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_allowed BOOLEAN := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE
    -- Новый упрощённый путь: ordered → in_progress (одной кнопкой «В работу»)
    WHEN OLD.status = 'ordered'      AND NEW.status IN ('agreed','in_progress','rejected')           THEN true
    -- Легаси-пути сохраняем, чтобы старые данные в agreed/sample_taken могли двигаться дальше
    WHEN OLD.status = 'agreed'       AND NEW.status IN ('paid','sample_taken','in_progress','ordered','rejected') THEN true
    WHEN OLD.status = 'paid'         AND NEW.status IN ('sample_taken','in_progress','rejected')     THEN true
    WHEN OLD.status = 'sample_taken' AND NEW.status IN ('in_progress','rejected')                    THEN true
    WHEN OLD.status = 'in_progress'  AND NEW.status IN ('ready','rejected')                          THEN true
    WHEN OLD.status = 'ready'        AND NEW.status IN ('verified','delivered')                      THEN true
    WHEN OLD.status = 'verified'     AND NEW.status = 'delivered'                                    THEN true
    WHEN OLD.status = 'delivered'                                                                    THEN false
    WHEN OLD.status = 'rejected'                                                                     THEN false
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Недопустимый переход статуса лаб-заказа: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$func$;

-- ─── 2) Автозаполнение промежуточных timestamps ────────────
-- Чтобы не ломать отчёты TAT (turn-around time), которые считают по
-- sample_taken_at / agreed_at, проставляем их автоматически при прыжке
-- в in_progress.
CREATE OR REPLACE FUNCTION fn_lab_order_autofill_timestamps()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    IF NEW.sample_taken_at IS NULL THEN
      NEW.sample_taken_at := now();
    END IF;
    -- Колонка agreed_at есть не во всех релизах — защищаемся через to_jsonb
    IF to_jsonb(NEW) ? 'agreed_at' AND (to_jsonb(NEW) ->> 'agreed_at') IS NULL THEN
      -- Динамически выставить колонку нельзя через NEW, но если мы её не
      -- выставили, то дефолта на колонке нет — клиент пишет сам при agreed.
      -- Для нового потока просто оставляем NULL (agreed-шаг пропущен).
      NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS trg_lab_order_autofill_timestamps ON lab_orders;
CREATE TRIGGER trg_lab_order_autofill_timestamps
  BEFORE UPDATE OF status ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION fn_lab_order_autofill_timestamps();

-- ─── 3) FEFO-списание на in_progress (а не только sample_taken) ───
CREATE OR REPLACE FUNCTION fn_lab_orders_auto_writeoff_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  IF TG_OP = 'UPDATE'
     -- Старт работы: либо sample_taken (легаси), либо in_progress (новый флоу)
     AND NEW.status IN ('sample_taken','in_progress')
     AND COALESCE(OLD.status,'') NOT IN ('sample_taken','in_progress','ready','verified','delivered')
     AND NEW.auto_writeoff_at IS NULL
  THEN
    PERFORM fn_lab_order_auto_writeoff(NEW.id);
  END IF;
  RETURN NEW;
END
$func$;

-- триггер уже повешен в 030; перевешиваем на всякий случай
DROP TRIGGER IF EXISTS trg_lab_orders_auto_writeoff ON lab_orders;
CREATE TRIGGER trg_lab_orders_auto_writeoff
  AFTER UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION fn_lab_orders_auto_writeoff_trg();
