-- ============================================================
-- 015_crm_amocrm.sql
-- amoCRM-style enhancements: value, dates, tags, assigned manager
-- ============================================================

-- ── Deals: add amoCRM-style fields ───────────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_value          DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS expected_close_date DATE,
  ADD COLUMN IF NOT EXISTS tags                TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_to         UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS custom_fields       JSONB NOT NULL DEFAULT '{}';

-- Source CHECK was too strict for free-form clinic-defined sources
-- (e.g. "Таргет", "2GIS", "Сайт") — drop the constraint, keep TEXT.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_source_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_source_check;
  END IF;
END$$;

-- ── Indexes for new filter/sort patterns ─────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_assigned_to    ON deals(assigned_to, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_deals_expected_close ON deals(expected_close_date) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_deals_tags           ON deals USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_deals_value          ON deals(deal_value DESC) WHERE status = 'open';

-- ── Helper view: deal with linked next task & last interaction ──
CREATE OR REPLACE VIEW v_deals_enriched AS
SELECT
  d.*,
  (
    SELECT row_to_json(t) FROM (
      SELECT id, title, due_at, status
      FROM tasks
      WHERE deal_id = d.id AND status IN ('new','in_progress')
      ORDER BY due_at NULLS LAST
      LIMIT 1
    ) t
  ) AS next_task,
  (
    SELECT MAX(created_at) FROM crm_interactions WHERE deal_id = d.id
  ) AS last_interaction_at
FROM deals d;
