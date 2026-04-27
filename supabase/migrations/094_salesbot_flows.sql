-- ============================================================
-- 094_salesbot_flows.sql
--
-- Диалоговый Salesbot («как в amoCRM»): пошаговый flow с вопросом,
-- кнопками/синонимами и переходами по ответу клиента.
--
-- Состоит из трёх таблиц:
--   • salesbot_flows  — определение бота: имя, нормализованный JSON шагов,
--                       стартовый шаг, событие запуска.
--   • salesbot_runs   — состояние конкретного запуска (одна сделка → один
--                       активный run); current_step хранит, на каком шаге
--                       мы сейчас «висим» в ожидании ответа.
--
-- Формат steps (нормализованный из amoCRM-экспорта):
--   {
--     "0": {
--        "text": "...",
--        "buttons": ["Актау","Жанаозен", ...],
--        "answers": [
--           { "value": "Актау", "synonyms": ["aktau","ақтау"], "next": 7 },
--           ...
--        ],
--        "else_next": 19,           // optional: ветка по «всё остальное»
--        "unconditional_next": 60    // optional: безусловный goto после отправки
--     }
--   }
-- ============================================================

CREATE TABLE IF NOT EXISTS salesbot_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  steps           JSONB NOT NULL,                       -- нормализованный flow
  start_step      INT  NOT NULL DEFAULT 0,
  source_json     JSONB,                                -- исходный экспорт amoCRM (для отладки)
  trigger_event   TEXT NOT NULL DEFAULT 'on_first_inbound'
                    CHECK (trigger_event IN ('on_first_inbound','on_deal_create','manual')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_default      BOOLEAN NOT NULL DEFAULT false,        -- автозапуск для входящих
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salesbot_flows_clinic
  ON salesbot_flows(clinic_id, is_active);

-- В клинике может быть только один default-бот для on_first_inbound,
-- остальные триггеры/ручной запуск — без ограничения.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salesbot_flows_default_on_inbound
  ON salesbot_flows(clinic_id)
  WHERE is_default AND trigger_event = 'on_first_inbound' AND is_active;

CREATE TABLE IF NOT EXISTS salesbot_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES salesbot_flows(id) ON DELETE CASCADE,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  current_step    INT  NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','finished','stopped')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- На сделку — не больше одного активного run одного flow одновременно.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salesbot_runs_one_active
  ON salesbot_runs(deal_id, flow_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_salesbot_runs_deal
  ON salesbot_runs(deal_id, status);

-- updated_at
CREATE OR REPLACE FUNCTION trg_salesbot_flows_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_salesbot_flows_updated_at ON salesbot_flows;
CREATE TRIGGER trg_salesbot_flows_updated_at
  BEFORE UPDATE ON salesbot_flows
  FOR EACH ROW EXECUTE FUNCTION trg_salesbot_flows_set_updated();

-- RLS
ALTER TABLE salesbot_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesbot_runs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesbot_flows_clinic ON salesbot_flows;
CREATE POLICY salesbot_flows_clinic ON salesbot_flows
  FOR ALL USING (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  ) WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS salesbot_runs_clinic ON salesbot_runs;
CREATE POLICY salesbot_runs_clinic ON salesbot_runs
  FOR ALL USING (
    deal_id IN (
      SELECT d.id FROM deals d
        JOIN user_profiles u ON u.clinic_id = d.clinic_id
       WHERE u.id = auth.uid()
    )
  ) WITH CHECK (
    deal_id IN (
      SELECT d.id FROM deals d
        JOIN user_profiles u ON u.clinic_id = d.clinic_id
       WHERE u.id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
