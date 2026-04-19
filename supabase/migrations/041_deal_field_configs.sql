-- ============================================================
-- 057_deal_field_configs.sql
--
-- Конфигурация полей карточки сделки (CRM).
-- Позволяет:
--   • скрывать / показывать встроенные поля
--   • менять порядок полей
--   • добавлять кастомные поля (text/number/date/select/phone/textarea)
--   • помечать поля обязательными глобально
--   • помечать поля обязательными на конкретных этапах воронки
--   • блокировать переход в следующий этап, если поле пустое
--
-- Кастомные значения хранятся в deals.custom_fields (JSONB).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Таблица конфигов
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_field_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  field_key             TEXT NOT NULL,                          -- 'pipeline','responsible',… или 'custom:slug'
  label                 TEXT,                                   -- кастомный лейбл (NULL → встроенный лейбл из кода)
  sort_order            INT  NOT NULL DEFAULT 0,
  is_visible            BOOLEAN NOT NULL DEFAULT true,
  is_required           BOOLEAN NOT NULL DEFAULT false,
  is_builtin            BOOLEAN NOT NULL DEFAULT false,         -- true = встроенное поле, false = кастомное
  field_type            TEXT NOT NULL DEFAULT 'text'
                          CHECK (field_type IN ('text','number','date','select','phone','textarea')),
  options               JSONB NOT NULL DEFAULT '[]'::jsonb,     -- для select: [{value,label}]
  required_in_stages    UUID[] NOT NULL DEFAULT '{}',           -- этапы pipeline_stages.id, в которых поле обязательно
  block_stage_progress  BOOLEAN NOT NULL DEFAULT false,         -- блокировать переход вперёд при пустом значении
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_deal_field_configs_clinic
  ON deal_field_configs(clinic_id, sort_order);

DROP TRIGGER IF EXISTS trg_deal_field_configs_updated_at ON deal_field_configs;
CREATE TRIGGER trg_deal_field_configs_updated_at
  BEFORE UPDATE ON deal_field_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. Колонка для значений кастомных полей в deals
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'deals' AND column_name = 'custom_fields'
  ) THEN
    ALTER TABLE deals ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────

ALTER TABLE deal_field_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_field_configs_clinic ON deal_field_configs;

-- Тот же паттерн, что в 036_crm_pipelines.sql и других CRM-таблицах:
-- доступ ограничен текущей клиникой через хелпер current_clinic_id().
CREATE POLICY deal_field_configs_clinic ON deal_field_configs
  FOR ALL TO authenticated
  USING      (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());

-- ─────────────────────────────────────────────────────────────
-- 4. Audit (если есть fn_audit_trigger)
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_deal_field_configs ON deal_field_configs';
    EXECUTE 'CREATE TRIGGER trg_audit_deal_field_configs
              AFTER INSERT OR UPDATE OR DELETE ON deal_field_configs
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
