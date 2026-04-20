-- ============================================================
-- 045_deal_autocreate_manual_stage.sql
--
-- Цель: после записи менеджер сам выбирает этап сделки.
--
-- Предыдущая миграция 044 создавала сделки сразу в won-стадии
-- («Записан») + триггер fn_appointment_advance_deal из 037 ещё и
-- насильно двигал туда же существующие открытые сделки. Менеджер
-- не мог контролировать воронку.
--
-- Меняем поведение:
--   1) fn_find_or_create_deal_for_patient теперь создаёт сделку
--      в ПЕРВОЙ normal-стадии (обычно «Неразобранное»/«Чек-ап»)
--      ПЕРВОЙ активной воронки по sort_order (не по code='leads').
--      status='open'. Пусть менеджер сам двигает.
--   2) Отключаем триггер trg_appointment_advance_deal: он конфликтует
--      с ручным управлением этапами. Функцию оставляем в БД на случай,
--      если кто-то захочет вернуть авто-переход.
--   3) Переносим уже созданные миграцией 044 сделки в «Неразобранное»
--      первой воронки (status='open'). Чтобы не дёргать trg_deal_stage_history
--      лишний раз и не добавлять шумные записи в историю, делаем один UPDATE.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Новая логика find-or-create
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

  -- 1) Если у пациента уже есть открытая сделка (в любой нетерминальной
  --    стадии) — используем её. Менеджер сам решит, когда её продвинуть.
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

  -- 2) Выбираем воронку: первую активную по sort_order (= левая вкладка в UI).
  --    Это надёжнее, чем искать code='leads' — клиника могла переименовать
  --    или создать кастомные воронки без системных кодов.
  SELECT p.id INTO v_pipeline_id
    FROM pipelines p
   WHERE p.clinic_id = p_clinic_id
     AND p.is_active = true
   ORDER BY p.sort_order ASC, p.created_at ASC
   LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 3) Стадия: первая NORMAL по sort_order (обычно «Неразобранное»).
  --    Менеджер потом перетащит на нужную.
  SELECT s.id INTO v_stage_id
    FROM pipeline_stages s
   WHERE s.pipeline_id = v_pipeline_id
     AND s.is_active   = true
     AND s.stage_role  = 'normal'
   ORDER BY s.sort_order ASC
   LIMIT 1;

  -- Фолбэк: вообще любая активная стадия.
  IF v_stage_id IS NULL THEN
    SELECT s.id INTO v_stage_id
      FROM pipeline_stages s
     WHERE s.pipeline_id = v_pipeline_id
       AND s.is_active   = true
     ORDER BY s.sort_order ASC
     LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_patient_name FROM patients WHERE id = p_patient_id;

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
    'leads', 'new',        -- legacy TEXT-пара (пройдёт старые CHECK)
    COALESCE(NULLIF(v_patient_name, ''), 'Запись на приём'),
    'open',                -- менеджер сам решит куда двигать
    'other',
    'warm',
    now()
  )
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Отключить автопродвижение appointment → Записан
-- ─────────────────────────────────────────────────────────────
-- Триггер fn_appointment_advance_deal из 037_deal_linkage.sql
-- автоматически двигает сделку в won-стадию при создании приёма.
-- Пользователь явно попросил управлять стадиями вручную. Сносим
-- только триггер; функцию оставляем в БД — вернуть её одной строкой:
--   CREATE TRIGGER trg_appointment_advance_deal AFTER INSERT ON appointments
--     FOR EACH ROW EXECUTE FUNCTION fn_appointment_advance_deal();

DROP TRIGGER IF EXISTS trg_appointment_advance_deal ON appointments;

-- ─────────────────────────────────────────────────────────────
-- 3. Переместить уже созданные миграцией 044 сделки
-- ─────────────────────────────────────────────────────────────
-- Признак «создано автоматически при бэкфилле 044»: status='won',
-- stage в win-role, и deal связан с appointment.deal_id (а не с
-- ручным созданием из CRM). Осторожно: двигаем только сделки, у
-- которых в истории (deal_stage_history) нет записей — то есть
-- они ни разу не меняли стадию вручную.

DO $$
DECLARE
  r RECORD;
  v_pipeline_id UUID;
  v_stage_id    UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT d.id, d.clinic_id
      FROM deals d
      JOIN pipeline_stages ps ON ps.id = d.stage_id
     WHERE d.status = 'won'
       AND ps.stage_role = 'won'
       AND d.deleted_at IS NULL
       -- ни одной записи в истории стадий → сделка никогда не перемещалась руками
       AND NOT EXISTS (SELECT 1 FROM deal_stage_history h WHERE h.deal_id = d.id)
       -- она была сгенерирована миграцией 044 (привязана к appointment)
       AND EXISTS (SELECT 1 FROM appointments a WHERE a.deal_id = d.id)
  LOOP
    -- Первая активная воронка клиники
    SELECT p.id INTO v_pipeline_id
      FROM pipelines p
     WHERE p.clinic_id = r.clinic_id
       AND p.is_active = true
     ORDER BY p.sort_order ASC, p.created_at ASC
     LIMIT 1;

    IF v_pipeline_id IS NULL THEN CONTINUE; END IF;

    -- Первая normal-стадия этой воронки
    SELECT s.id INTO v_stage_id
      FROM pipeline_stages s
     WHERE s.pipeline_id = v_pipeline_id
       AND s.is_active   = true
       AND s.stage_role  = 'normal'
     ORDER BY s.sort_order ASC
     LIMIT 1;

    IF v_stage_id IS NULL THEN CONTINUE; END IF;

    -- Один UPDATE двигает и саму сделку, и её legacy TEXT-поля.
    -- trg_deal_stage_history сработает и залогирует перенос — это
    -- нормально, так менеджер увидит в истории, как сделка попала
    -- в «Неразобранное».
    UPDATE deals
       SET pipeline_id = v_pipeline_id,
           stage_id    = v_stage_id,
           status      = 'open',
           stage       = 'new',   -- синхронизируем legacy TEXT
           funnel      = 'leads'
     WHERE id = r.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
