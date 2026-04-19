-- ============================================================
-- 036_crm_pipelines.sql — управляемые CRM-воронки (production-уровень)
--
-- Расширяет существующую CRM (migration 004) без поломки:
--  • pipelines               — воронки (Лиды / Медицинская / кастомные)
--  • pipeline_stages         — этапы воронки (название, цвет, порядок, роль, KPI-флаг)
--  • stage_transitions       — заготовка под ограничения переходов
--  • deal_loss_reasons       — справочник причин потери (per-pipeline)
--  • deal_loss_logs          — лог применённых причин + коммент
--  • lead_sources            — справочник источников (per-clinic)
--  • deals.{pipeline_id,stage_id,responsible_user_id,source_id,amount,name}
--  • deal_stage_history.{from_stage_id,to_stage_id,time_in_stage_seconds}
--
-- Совместимость:
--  • старые deals.{funnel,stage} и deal_stage_history.{from_stage,to_stage}
--    сохраняются и продолжают обновляться триггером.
--  • новые FK-колонки заполняются backfill-ом.
--
-- Seed (идемпотентно):
--  для каждой клиники создаются 2 системные воронки с кодами
--  'leads' и 'medical' и полными наборами стадий из ТЗ.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Справочные таблицы
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,              -- 'leads' | 'medical' | кастомный
  name        TEXT NOT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
CREATE INDEX IF NOT EXISTS idx_pipelines_clinic ON pipelines(clinic_id, is_active);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id    UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  color          TEXT NOT NULL DEFAULT '#94a3b8',
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  stage_role     TEXT NOT NULL DEFAULT 'normal'
                   CHECK (stage_role IN ('normal','won','lost','closed')),
  is_system      BOOLEAN NOT NULL DEFAULT false,
  is_editable    BOOLEAN NOT NULL DEFAULT true,
  is_deletable   BOOLEAN NOT NULL DEFAULT true,
  counts_in_kpi  BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, code),
  UNIQUE (pipeline_id, name)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id, sort_order);

-- Заготовка под ограничения переходов (не enforced сейчас)
CREATE TABLE IF NOT EXISTS stage_transitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage_id  UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  to_stage_id    UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  is_allowed     BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_stage_id, to_stage_id)
);

CREATE TABLE IF NOT EXISTS deal_loss_reasons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,   -- NULL = для всех воронок клиники
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_loss_reasons_clinic ON deal_loss_reasons(clinic_id, is_active);

CREATE TABLE IF NOT EXISTS deal_loss_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  reason_id   UUID REFERENCES deal_loss_reasons(id) ON DELETE SET NULL,
  reason_name TEXT,                 -- снимок имени на момент лога
  comment     TEXT,
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_loss_logs_deal ON deal_loss_logs(deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, name)
);

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_pipelines_updated_at        ON pipelines;
DROP TRIGGER IF EXISTS trg_pipeline_stages_updated_at  ON pipeline_stages;
CREATE TRIGGER trg_pipelines_updated_at
  BEFORE UPDATE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pipeline_stages_updated_at
  BEFORE UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. Расширение deals и deal_stage_history
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='pipeline_id') THEN
    ALTER TABLE deals ADD COLUMN pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='stage_id') THEN
    ALTER TABLE deals ADD COLUMN stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='responsible_user_id') THEN
    ALTER TABLE deals ADD COLUMN responsible_user_id UUID REFERENCES user_profiles(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='source_id') THEN
    ALTER TABLE deals ADD COLUMN source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='amount') THEN
    ALTER TABLE deals ADD COLUMN amount DECIMAL(12,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='name') THEN
    ALTER TABLE deals ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='tags') THEN
    ALTER TABLE deals ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='stage_entered_at') THEN
    ALTER TABLE deals ADD COLUMN stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='deleted_at') THEN
    ALTER TABLE deals ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  -- closed добавим в CHECK статуса при необходимости — пока 'open/won/lost'
END $$;

-- Снять существующий CHECK со status и пересоздать с 'closed'
DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint c
    JOIN pg_class r ON r.oid=c.conrelid
   WHERE r.relname='deals' AND c.contype='c'
     AND pg_get_constraintdef(c.oid) LIKE '%status%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE deals DROP CONSTRAINT %I', v_conname);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_status_check_v2'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_status_check_v2
      CHECK (status IN ('open','won','lost','closed'));
  END IF;
END $$;

-- Patient не обязателен для лидов
DO $$
BEGIN
  -- Снимаем NOT NULL с patient_id если есть
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='deals' AND column_name='patient_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE deals ALTER COLUMN patient_id DROP NOT NULL;
  END IF;
END $$;

-- deal_stage_history — FK-колонки и тайминг стадии
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deal_stage_history' AND column_name='from_stage_id') THEN
    ALTER TABLE deal_stage_history ADD COLUMN from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deal_stage_history' AND column_name='to_stage_id') THEN
    ALTER TABLE deal_stage_history ADD COLUMN to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deal_stage_history' AND column_name='time_in_stage_seconds') THEN
    ALTER TABLE deal_stage_history ADD COLUMN time_in_stage_seconds INT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage  ON deals(pipeline_id, stage_id) WHERE status IN ('open','won','lost');
CREATE INDEX IF NOT EXISTS idx_deals_responsible     ON deals(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_source          ON deals(source_id);
CREATE INDEX IF NOT EXISTS idx_stage_history_deal    ON deal_stage_history(deal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stage_history_to      ON deal_stage_history(to_stage_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- 3. Seed: воронки и стадии для каждой клиники
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_clinic RECORD;
  v_leads_id UUID;
  v_med_id   UUID;
BEGIN
  FOR v_clinic IN SELECT id FROM clinics LOOP
    -- LEADS pipeline
    INSERT INTO pipelines (clinic_id, code, name, is_system, sort_order)
    VALUES (v_clinic.id, 'leads', 'Лиды', true, 1)
    ON CONFLICT (clinic_id, code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_leads_id;

    INSERT INTO pipeline_stages (pipeline_id, code, name, color, sort_order, stage_role, is_system, is_deletable, counts_in_kpi) VALUES
      (v_leads_id, 'new',         'Неразобранное',  '#94a3b8', 10, 'normal', true,  false, true),
      (v_leads_id, 'in_progress', 'В работе',       '#3b82f6', 20, 'normal', true,  false, true),
      (v_leads_id, 'contact',     'Касание',        '#f59e0b', 30, 'normal', false, true,  true),
      (v_leads_id, 'booked',      'Записан',        '#10b981', 40, 'won',    true,  false, true),
      (v_leads_id, 'failed',      'Не реализована', '#dc2626', 90, 'lost',   true,  false, false),
      (v_leads_id, 'closed',      'Закрыто',        '#6b7280', 100,'closed', true,  false, false)
    ON CONFLICT (pipeline_id, code) DO NOTHING;

    -- MEDICAL pipeline
    INSERT INTO pipelines (clinic_id, code, name, is_system, sort_order)
    VALUES (v_clinic.id, 'medical', 'Медицинская', true, 2)
    ON CONFLICT (clinic_id, code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_med_id;

    INSERT INTO pipeline_stages (pipeline_id, code, name, color, sort_order, stage_role, is_system, is_deletable, counts_in_kpi) VALUES
      (v_med_id, 'checkup',              'Чек-ап',                             '#6366f1', 10, 'normal', true,  false, true),
      (v_med_id, 'primary_scheduled',    'Назначена первичная консультация',   '#3b82f6', 20, 'normal', true,  false, true),
      (v_med_id, 'primary_done',         'Проведена первичная консультация',   '#10b981', 30, 'normal', true,  false, true),
      (v_med_id, 'secondary_scheduled',  'Назначена вторичная',                '#06b6d4', 40, 'normal', true,  false, true),
      (v_med_id, 'secondary_done',       'Проведена вторичная',                '#0891b2', 50, 'normal', true,  false, true),
      (v_med_id, 'deciding',             'Принимают решение',                  '#f59e0b', 60, 'normal', true,  false, true),
      (v_med_id, 'treatment',            'Лечение',                            '#84cc16', 70, 'normal', true,  false, true),
      (v_med_id, 'control_tests',        'Контрольные анализы',                '#14b8a6', 80, 'normal', true,  false, true),
      (v_med_id, 'success',              'Успешно реализована',                '#16a34a', 90, 'won',    true,  false, true),
      (v_med_id, 'failed',               'Не реализована',                     '#dc2626', 95, 'lost',   true,  false, false),
      (v_med_id, 'closed',               'Закрыто',                            '#6b7280', 100,'closed', true,  false, false)
    ON CONFLICT (pipeline_id, code) DO NOTHING;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Seed дефолтных причин потери и источников (если пусто)
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE v_clinic RECORD;
BEGIN
  FOR v_clinic IN SELECT id FROM clinics LOOP
    IF NOT EXISTS (SELECT 1 FROM deal_loss_reasons WHERE clinic_id = v_clinic.id) THEN
      INSERT INTO deal_loss_reasons (clinic_id, name, sort_order) VALUES
        (v_clinic.id, 'Дорого',                 10),
        (v_clinic.id, 'Думает',                 20),
        (v_clinic.id, 'Не отвечает',            30),
        (v_clinic.id, 'Ушёл в другую клинику',  40),
        (v_clinic.id, 'Отказался',              50),
        (v_clinic.id, 'Другое',                 99);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM lead_sources WHERE clinic_id = v_clinic.id) THEN
      INSERT INTO lead_sources (clinic_id, name, sort_order) VALUES
        (v_clinic.id, 'Instagram',    10),
        (v_clinic.id, 'WhatsApp',     20),
        (v_clinic.id, 'Таргет',       30),
        (v_clinic.id, '2GIS',         40),
        (v_clinic.id, 'Сайт',         50),
        (v_clinic.id, 'Рекомендация', 60),
        (v_clinic.id, 'Другое',       99)
      ON CONFLICT (clinic_id, name) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Backfill существующих deals: проставить pipeline_id/stage_id
--    из legacy-пары (funnel, stage)
-- ─────────────────────────────────────────────────────────────

UPDATE deals d
   SET pipeline_id = p.id
  FROM pipelines p
 WHERE d.pipeline_id IS NULL
   AND p.clinic_id = d.clinic_id
   AND p.code = d.funnel;

UPDATE deals d
   SET stage_id = s.id
  FROM pipeline_stages s
  JOIN pipelines p ON p.id = s.pipeline_id
 WHERE d.stage_id IS NULL
   AND d.pipeline_id = p.id
   AND s.code = d.stage;

-- Если код не совпал (например, stage='tirzepatide_service' которого нет
-- в системном сете) — ставим первую NORMAL-стадию воронки, чтобы deal не потерялся.
UPDATE deals d
   SET stage_id = s.id
  FROM pipeline_stages s
 WHERE d.stage_id IS NULL
   AND d.pipeline_id IS NOT NULL
   AND s.pipeline_id = d.pipeline_id
   AND s.stage_role = 'normal'
   AND s.sort_order = (
         SELECT MIN(sort_order) FROM pipeline_stages
          WHERE pipeline_id = d.pipeline_id AND stage_role = 'normal'
       );

-- Backfill stage_entered_at из последнего history (если был)
UPDATE deals d
   SET stage_entered_at = COALESCE(
         (SELECT MAX(created_at) FROM deal_stage_history WHERE deal_id = d.id),
         d.created_at
       )
 WHERE d.stage_entered_at IS NULL OR d.stage_entered_at = d.created_at;

-- Backfill истории: проставить to_stage_id где возможно
UPDATE deal_stage_history h
   SET to_stage_id = s.id
  FROM deals d
  JOIN pipeline_stages s ON s.pipeline_id = d.pipeline_id AND s.code = h.to_stage
 WHERE h.deal_id = d.id AND h.to_stage_id IS NULL;

UPDATE deal_stage_history h
   SET from_stage_id = s.id
  FROM deals d
  JOIN pipeline_stages s ON s.pipeline_id = d.pipeline_id AND s.code = h.from_stage
 WHERE h.deal_id = d.id AND h.from_stage_id IS NULL AND h.from_stage IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. Новый триггер на deals: ведёт и TEXT, и FK, считает время на этапе
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_code TEXT;
  v_new_code TEXT;
  v_pipeline UUID;
  v_seconds  INT;
BEGIN
  -- Синхронизируем legacy TEXT с FK если поменялся stage_id
  IF TG_OP = 'UPDATE' AND OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    SELECT s.code, s.pipeline_id INTO v_new_code, v_pipeline
      FROM pipeline_stages s WHERE s.id = NEW.stage_id;
    IF v_new_code IS NOT NULL THEN
      NEW.stage := v_new_code;
      NEW.pipeline_id := COALESCE(NEW.pipeline_id, v_pipeline);
    END IF;
  END IF;

  -- Фиксируем смену этапа (по любому из признаков)
  IF TG_OP = 'UPDATE' AND (
       OLD.stage IS DISTINCT FROM NEW.stage
    OR OLD.stage_id IS DISTINCT FROM NEW.stage_id
  ) THEN
    v_seconds := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(OLD.stage_entered_at, OLD.created_at)))::INT);

    INSERT INTO deal_stage_history (
      deal_id, clinic_id,
      from_stage, to_stage,
      from_stage_id, to_stage_id,
      time_in_stage_seconds,
      changed_by
    ) VALUES (
      NEW.id, NEW.clinic_id,
      OLD.stage, NEW.stage,
      OLD.stage_id, NEW.stage_id,
      v_seconds,
      auth.uid()
    );

    NEW.stage_entered_at := now();

    -- SLA первая реакция
    IF NEW.stage IN ('contact','in_progress') AND NEW.first_response_at IS NULL THEN
      NEW.first_response_at := now();
      NEW.time_to_response_s := EXTRACT(EPOCH FROM (now() - NEW.created_at))::INT;
    END IF;
    -- SLA запись
    IF NEW.stage = 'booked' AND NEW.booked_at IS NULL THEN
      NEW.booked_at := now();
      NEW.time_to_booking_s := EXTRACT(EPOCH FROM (now() - NEW.created_at))::INT;
    END IF;

    -- Автоперевод status на основе stage_role
    IF NEW.stage_id IS NOT NULL THEN
      SELECT CASE stage_role
               WHEN 'won'    THEN 'won'
               WHEN 'lost'   THEN 'lost'
               WHEN 'closed' THEN 'closed'
               ELSE 'open'
             END
        INTO NEW.status
        FROM pipeline_stages WHERE id = NEW.stage_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Триггер уже создан в 004; переустановим на всякий случай
DROP TRIGGER IF EXISTS trg_deal_stage_history ON deals;
CREATE TRIGGER trg_deal_stage_history
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION record_deal_stage_change();

-- ─────────────────────────────────────────────────────────────
-- 7. Защита: нельзя удалить этап с активными сделками
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_pipeline_stage_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_count INT;
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system stage (%)', OLD.code;
  END IF;
  IF NOT OLD.is_deletable THEN
    RAISE EXCEPTION 'Stage (%) is not deletable', OLD.code;
  END IF;
  SELECT COUNT(*) INTO v_count FROM deals WHERE stage_id = OLD.id AND deleted_at IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Stage (%) has % active deals; move or close them first', OLD.code, v_count;
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS trg_pipeline_stage_before_delete ON pipeline_stages;
CREATE TRIGGER trg_pipeline_stage_before_delete
  BEFORE DELETE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION fn_pipeline_stage_before_delete();

-- ─────────────────────────────────────────────────────────────
-- 8. RLS
-- ─────────────────────────────────────────────────────────────

ALTER TABLE pipelines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_transitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_loss_reasons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_loss_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipelines_clinic         ON pipelines;
DROP POLICY IF EXISTS pipeline_stages_clinic   ON pipeline_stages;
DROP POLICY IF EXISTS stage_transitions_clinic ON stage_transitions;
DROP POLICY IF EXISTS deal_loss_reasons_clinic ON deal_loss_reasons;
DROP POLICY IF EXISTS deal_loss_logs_clinic    ON deal_loss_logs;
DROP POLICY IF EXISTS lead_sources_clinic      ON lead_sources;

CREATE POLICY pipelines_clinic ON pipelines
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

CREATE POLICY pipeline_stages_clinic ON pipeline_stages
  FOR ALL TO authenticated
  USING (pipeline_id IN (SELECT id FROM pipelines WHERE clinic_id = current_clinic_id()))
  WITH CHECK (pipeline_id IN (SELECT id FROM pipelines WHERE clinic_id = current_clinic_id()));

CREATE POLICY stage_transitions_clinic ON stage_transitions
  FOR ALL TO authenticated
  USING (from_stage_id IN (
      SELECT s.id FROM pipeline_stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE p.clinic_id = current_clinic_id()))
  WITH CHECK (from_stage_id IN (
      SELECT s.id FROM pipeline_stages s
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE p.clinic_id = current_clinic_id()));

CREATE POLICY deal_loss_reasons_clinic ON deal_loss_reasons
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

CREATE POLICY deal_loss_logs_clinic ON deal_loss_logs
  FOR ALL TO authenticated
  USING (deal_id IN (SELECT id FROM deals WHERE clinic_id = current_clinic_id()))
  WITH CHECK (deal_id IN (SELECT id FROM deals WHERE clinic_id = current_clinic_id()));

CREATE POLICY lead_sources_clinic ON lead_sources
  FOR ALL TO authenticated
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- ─────────────────────────────────────────────────────────────
-- 9. Audit (если есть fn_audit_trigger)
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_pipelines ON pipelines';
    EXECUTE 'CREATE TRIGGER trg_audit_pipelines
              AFTER INSERT OR UPDATE OR DELETE ON pipelines
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_pipeline_stages ON pipeline_stages';
    EXECUTE 'CREATE TRIGGER trg_audit_pipeline_stages
              AFTER INSERT OR UPDATE OR DELETE ON pipeline_stages
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_deal_loss_reasons ON deal_loss_reasons';
    EXECUTE 'CREATE TRIGGER trg_audit_deal_loss_reasons
              AFTER INSERT OR UPDATE OR DELETE ON deal_loss_reasons
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_deal_loss_logs ON deal_loss_logs';
    EXECUTE 'CREATE TRIGGER trg_audit_deal_loss_logs
              AFTER INSERT OR UPDATE OR DELETE ON deal_loss_logs
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_lead_sources ON lead_sources';
    EXECUTE 'CREATE TRIGGER trg_audit_lead_sources
              AFTER INSERT OR UPDATE OR DELETE ON lead_sources
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 10. KPI views
-- ─────────────────────────────────────────────────────────────

-- Количество активных сделок в стадии
CREATE OR REPLACE VIEW v_pipeline_stage_counts AS
SELECT
  s.pipeline_id,
  s.id                                                   AS stage_id,
  s.code                                                 AS stage_code,
  s.name                                                 AS stage_name,
  s.sort_order,
  s.stage_role,
  s.counts_in_kpi,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL)        AS deals_count,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL
                        AND d.status = 'open')           AS open_count
FROM pipeline_stages s
LEFT JOIN deals d ON d.stage_id = s.id
GROUP BY s.id;

GRANT SELECT ON v_pipeline_stage_counts TO authenticated;

-- Среднее время на этапе (по закрытым историческим транзитам)
CREATE OR REPLACE VIEW v_pipeline_stage_avg_time AS
SELECT
  h.from_stage_id                               AS stage_id,
  COUNT(*)                                      AS transitions_count,
  AVG(h.time_in_stage_seconds)::INT             AS avg_seconds,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY h.time_in_stage_seconds) AS median_seconds
FROM deal_stage_history h
WHERE h.from_stage_id IS NOT NULL
  AND h.time_in_stage_seconds IS NOT NULL
GROUP BY h.from_stage_id;

GRANT SELECT ON v_pipeline_stage_avg_time TO authenticated;

-- Конверсия: доля сделок, дошедших до won
CREATE OR REPLACE VIEW v_pipeline_conversion AS
SELECT
  p.id               AS pipeline_id,
  p.clinic_id,
  p.name             AS pipeline_name,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL)                                   AS total,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status = 'won')              AS won,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status = 'lost')             AS lost,
  COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status = 'open')             AS open_count,
  CASE
    WHEN COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status IN ('won','lost')) > 0
    THEN ROUND(
      100.0 * COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status = 'won') /
      NULLIF(COUNT(d.id) FILTER (WHERE d.deleted_at IS NULL AND d.status IN ('won','lost')), 0)
    , 1)
    ELSE NULL
  END AS conversion_pct
FROM pipelines p
LEFT JOIN deals d ON d.pipeline_id = p.id
GROUP BY p.id;

GRANT SELECT ON v_pipeline_conversion TO authenticated;

NOTIFY pgrst, 'reload schema';
