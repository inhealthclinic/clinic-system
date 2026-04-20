-- ============================================================
-- 044_autocreate_deal_from_appointment.sql
--
-- Цель: каждая запись на приём должна отражаться в CRM как сделка.
--
-- Сейчас: appointments.deal_id проставляется только когда модалку
-- открывают из карточки сделки в /crm. При прямой записи из /schedule
-- deal_id = NULL, и на доске CRM такого пациента не видно.
--
-- Решение (Вариант А): BEFORE INSERT триггер на appointments.
--   1. Если NEW.deal_id уже задан — ничего не делаем.
--   2. Если у пациента уже есть открытая сделка (status='open' И
--      стадия не в терминальных ролях won/lost/closed) — подхватываем
--      её id. Это частый кейс: лид из CRM, который ведут, потом админ
--      напрямую записывает из расписания.
--   3. Иначе создаём новую сделку в воронке 'leads' (или первой
--      активной) на won-стадии (обычно 'Записан') — приём уже есть,
--      значит лид конвертирован. Триггер record_deal_stage_change
--      поставит status='won' при смене стадии, но у нас INSERT —
--      поэтому status выставляем сразу.
--
-- Плюс: бэкфилл существующих appointments без deal_id.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Вспомогательная функция: найти или создать сделку пациента
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_find_or_create_deal_for_patient(
  p_clinic_id   UUID,
  p_patient_id  UUID
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal_id      UUID;
  v_pipeline_id  UUID;
  v_stage_id     UUID;
  v_patient_name TEXT;
BEGIN
  IF p_patient_id IS NULL OR p_clinic_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) Открытая сделка этого пациента в этой клинике
  SELECT d.id INTO v_deal_id
    FROM deals d
    LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
   WHERE d.patient_id = p_patient_id
     AND d.clinic_id  = p_clinic_id
     AND d.status     = 'open'
     AND d.deleted_at IS NULL
     AND (ps.stage_role IS NULL OR ps.stage_role NOT IN ('won','lost','closed'))
   ORDER BY d.created_at DESC
   LIMIT 1;

  IF v_deal_id IS NOT NULL THEN
    RETURN v_deal_id;
  END IF;

  -- 2) Нет открытой сделки — выбираем воронку. Предпочтение 'leads'.
  SELECT p.id INTO v_pipeline_id
    FROM pipelines p
   WHERE p.clinic_id = p_clinic_id
     AND p.is_active = true
     AND p.code      = 'leads'
   LIMIT 1;

  -- Фолбэк: первая активная воронка.
  IF v_pipeline_id IS NULL THEN
    SELECT p.id INTO v_pipeline_id
      FROM pipelines p
     WHERE p.clinic_id = p_clinic_id
       AND p.is_active = true
     ORDER BY p.sort_order
     LIMIT 1;
  END IF;

  -- Если воронок нет — сделку создать не из чего.
  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 3) Стадия: won-role (обычно 'Записан'), первая по sort_order.
  SELECT s.id INTO v_stage_id
    FROM pipeline_stages s
   WHERE s.pipeline_id = v_pipeline_id
     AND s.is_active   = true
     AND s.stage_role  = 'won'
   ORDER BY s.sort_order
   LIMIT 1;

  -- Фолбэк: первая normal-стадия.
  IF v_stage_id IS NULL THEN
    SELECT s.id INTO v_stage_id
      FROM pipeline_stages s
     WHERE s.pipeline_id = v_pipeline_id
       AND s.is_active   = true
       AND s.stage_role  = 'normal'
     ORDER BY s.sort_order
     LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_patient_name FROM patients WHERE id = p_patient_id;

  -- 4) Создаём сделку. Legacy-поля funnel/stage обязательны по CHECK
  --    из 004_crm.sql. Для любых воронок используем 'leads'/'booked'
  --    как безопасный default — они проходят CHECK и UI их игнорирует
  --    в пользу новых FK (pipeline_id/stage_id).
  INSERT INTO deals (
    clinic_id, patient_id,
    pipeline_id, stage_id,
    funnel, stage,
    name,
    status,
    source, priority,
    stage_entered_at
  ) VALUES (
    p_clinic_id, p_patient_id,
    v_pipeline_id, v_stage_id,
    'leads', 'booked',
    COALESCE(NULLIF(v_patient_name, ''), 'Запись на приём'),
    'won',           -- stage_role=won → status=won (аналогично логике record_deal_stage_change)
    'other',         -- источник неизвестен, CHECK допускает 'other'
    'warm',
    now()
  )
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. BEFORE INSERT триггер на appointments
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_appointment_autocreate_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal_id UUID;
BEGIN
  -- Если уже привязана сделка — уважаем, что передали.
  IF NEW.deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Без пациента сделки не бывает.
  IF NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_deal_id := fn_find_or_create_deal_for_patient(NEW.clinic_id, NEW.patient_id);

  IF v_deal_id IS NOT NULL THEN
    NEW.deal_id := v_deal_id;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_appointment_autocreate_deal ON appointments;
CREATE TRIGGER trg_appointment_autocreate_deal
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_appointment_autocreate_deal();

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill: существующие appointments без deal_id
-- ─────────────────────────────────────────────────────────────
-- Делаем в цикле по (clinic_id, patient_id), чтобы все приёмы одного
-- пациента привязались к одной и той же сделке, а не к отдельным.
DO $$
DECLARE
  r RECORD;
  v_deal_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT clinic_id, patient_id
      FROM appointments
     WHERE deal_id    IS NULL
       AND patient_id IS NOT NULL
  LOOP
    v_deal_id := fn_find_or_create_deal_for_patient(r.clinic_id, r.patient_id);
    IF v_deal_id IS NOT NULL THEN
      UPDATE appointments
         SET deal_id = v_deal_id
       WHERE clinic_id  = r.clinic_id
         AND patient_id = r.patient_id
         AND deal_id    IS NULL;
    END IF;
  END LOOP;
END $$;

-- Триггер fn_visit_inherit_deal (из 037_deal_linkage.sql) уже подтянет
-- deal_id в visits/charges при следующих вставках. Для существующих
-- строк visits/charges — подтянем вручную.
UPDATE visits v
   SET deal_id = a.deal_id
  FROM appointments a
 WHERE v.appointment_id = a.id
   AND v.deal_id IS NULL
   AND a.deal_id IS NOT NULL;

UPDATE charges c
   SET deal_id = v.deal_id
  FROM visits v
 WHERE c.visit_id = v.id
   AND c.deal_id IS NULL
   AND v.deal_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
