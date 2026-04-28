-- ============================================================
-- 103_salesbot_visual_graph.sql
--
-- Визуальный слой поверх salesbot_flows — для builder-UI «как amoCRM».
-- Источник правды для рантайма (WhatsApp) остаётся salesbot_flows.steps.
-- Эти таблицы хранят визуальный граф (узлы + связи + позиции на canvas)
-- и при «публикации» компилируются обратно в salesbot_flows.steps.
--
-- Связь с salesbot_flows: 1 flow ↔ N nodes ↔ M edges. ON DELETE CASCADE.
-- ============================================================

CREATE TABLE IF NOT EXISTS salesbot_nodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           UUID NOT NULL REFERENCES salesbot_flows(id) ON DELETE CASCADE,
  external_step_id  INT,                         -- ключ из amoCRM-экспорта ("0","7",…); NULL для новых блоков
  block_uuid        UUID,                        -- amoCRM block_uuid; NULL для новых
  type              TEXT NOT NULL CHECK (type IN (
                      'start','message','question_buttons','goto',
                      'condition','crm_action','delay','final'
                    )),
  title             TEXT,
  config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
                    -- Для message:           {text, buttons[]}
                    -- Для question_buttons:  {text, buttons[], answers:[{value,synonyms[],next?}], else_next?}
                    -- Для goto:              {target_step}
                    -- Для condition:         {variable, op, value}
                    -- Для crm_action:        {action, params}
                    -- Для delay:             {seconds}
  position_x        INT NOT NULL DEFAULT 0,
  position_y        INT NOT NULL DEFAULT 0,
  width             INT NOT NULL DEFAULT 320,
  height            INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salesbot_nodes_flow
  ON salesbot_nodes(flow_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salesbot_nodes_flow_step
  ON salesbot_nodes(flow_id, external_step_id)
  WHERE external_step_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_salesbot_nodes_flow_uuid
  ON salesbot_nodes(flow_id, block_uuid)
  WHERE block_uuid IS NOT NULL;


CREATE TABLE IF NOT EXISTS salesbot_edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           UUID NOT NULL REFERENCES salesbot_flows(id) ON DELETE CASCADE,
  source_node_id    UUID NOT NULL REFERENCES salesbot_nodes(id) ON DELETE CASCADE,
  target_node_id    UUID NOT NULL REFERENCES salesbot_nodes(id) ON DELETE CASCADE,
  source_handle     TEXT NOT NULL DEFAULT 'out',
                    -- Для question_buttons: значение кнопки ("Актау") или "__else__"
                    -- Для message с goto:    "__unconditional__"
                    -- Для condition:         "true" | "false"
  label             TEXT,
  condition_json    JSONB,                       -- зарезервировано под condition-узлы
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salesbot_edges_flow
  ON salesbot_edges(flow_id);
CREATE INDEX IF NOT EXISTS idx_salesbot_edges_source
  ON salesbot_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_salesbot_edges_target
  ON salesbot_edges(target_node_id);

-- Не допускаем дубликаты «source + handle» — у одной кнопки одна стрелка.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salesbot_edges_source_handle
  ON salesbot_edges(source_node_id, source_handle);


-- updated_at автообновление для nodes
CREATE OR REPLACE FUNCTION trg_salesbot_nodes_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_salesbot_nodes_updated_at ON salesbot_nodes;
CREATE TRIGGER trg_salesbot_nodes_updated_at
  BEFORE UPDATE ON salesbot_nodes
  FOR EACH ROW EXECUTE FUNCTION trg_salesbot_nodes_set_updated();


-- RLS — доступ через flow → clinic, как в salesbot_flows.
ALTER TABLE salesbot_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesbot_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesbot_nodes_clinic ON salesbot_nodes;
CREATE POLICY salesbot_nodes_clinic ON salesbot_nodes
  FOR ALL USING (
    flow_id IN (
      SELECT f.id FROM salesbot_flows f
        JOIN user_profiles u ON u.clinic_id = f.clinic_id
       WHERE u.id = auth.uid()
    )
  ) WITH CHECK (
    flow_id IN (
      SELECT f.id FROM salesbot_flows f
        JOIN user_profiles u ON u.clinic_id = f.clinic_id
       WHERE u.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS salesbot_edges_clinic ON salesbot_edges;
CREATE POLICY salesbot_edges_clinic ON salesbot_edges
  FOR ALL USING (
    flow_id IN (
      SELECT f.id FROM salesbot_flows f
        JOIN user_profiles u ON u.clinic_id = f.clinic_id
       WHERE u.id = auth.uid()
    )
  ) WITH CHECK (
    flow_id IN (
      SELECT f.id FROM salesbot_flows f
        JOIN user_profiles u ON u.clinic_id = f.clinic_id
       WHERE u.id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
