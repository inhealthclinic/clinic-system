-- ============================================================
-- 016_crm_source_backfill.sql
-- Backfill `deals.source` rows that were inserted with the
-- Russian display label (before the UI started normalising to
-- the DB-safe enum values).  Safe to re-run.
--
-- Mapping mirrors src/lib/crm/constants.ts → SOURCE_OPTIONS:
--   Таргет        → target
--   Instagram     → instagram
--   WhatsApp      → whatsapp
--   Рекомендация  → referral
--   Сайт          → organic
--   2GIS          → other
--   Повторный     → repeat
--
-- Migration 015 already drops the `deals_source_check` constraint
-- (free-form clinic-defined sources are allowed at the column
--  level), but we still want a clean canonical value space so
-- analytics, filters and grouping work uniformly.
-- ============================================================

-- Trim & lowercase the working set to make matches idempotent.
WITH normalised AS (
  SELECT id,
         lower(btrim(source)) AS s_norm,
         source                AS s_orig
  FROM deals
  WHERE source IS NOT NULL
)
UPDATE deals d
SET source = CASE n.s_norm
  WHEN 'таргет'        THEN 'target'
  WHEN 'target'        THEN 'target'
  WHEN 'instagram'     THEN 'instagram'
  WHEN 'инстаграм'     THEN 'instagram'
  WHEN 'инст'          THEN 'instagram'
  WHEN 'whatsapp'      THEN 'whatsapp'
  WHEN 'ватсап'        THEN 'whatsapp'
  WHEN 'вотсап'        THEN 'whatsapp'
  WHEN 'рекомендация'  THEN 'referral'
  WHEN 'сарафан'       THEN 'referral'
  WHEN 'referral'      THEN 'referral'
  WHEN 'сайт'          THEN 'organic'
  WHEN 'site'          THEN 'organic'
  WHEN 'organic'       THEN 'organic'
  WHEN '2gis'          THEN 'other'
  WHEN '2 гис'         THEN 'other'
  WHEN '2гис'          THEN 'other'
  WHEN 'повторный'     THEN 'repeat'
  WHEN 'repeat'        THEN 'repeat'
  WHEN 'другое'        THEN 'other'
  WHEN 'other'         THEN 'other'
  ELSE 'other'                            -- catch-all to keep enum clean
END
FROM normalised n
WHERE d.id = n.id
  AND d.source <> CASE n.s_norm
    WHEN 'таргет'        THEN 'target'
    WHEN 'target'        THEN 'target'
    WHEN 'instagram'     THEN 'instagram'
    WHEN 'инстаграм'     THEN 'instagram'
    WHEN 'инст'          THEN 'instagram'
    WHEN 'whatsapp'      THEN 'whatsapp'
    WHEN 'ватсап'        THEN 'whatsapp'
    WHEN 'вотсап'        THEN 'whatsapp'
    WHEN 'рекомендация'  THEN 'referral'
    WHEN 'сарафан'       THEN 'referral'
    WHEN 'referral'      THEN 'referral'
    WHEN 'сайт'          THEN 'organic'
    WHEN 'site'          THEN 'organic'
    WHEN 'organic'       THEN 'organic'
    WHEN '2gis'          THEN 'other'
    WHEN '2 гис'         THEN 'other'
    WHEN '2гис'          THEN 'other'
    WHEN 'повторный'     THEN 'repeat'
    WHEN 'repeat'        THEN 'repeat'
    WHEN 'другое'        THEN 'other'
    WHEN 'other'         THEN 'other'
    ELSE 'other'
  END;

-- Optional: re-introduce a (looser) CHECK so future code can't smuggle
-- in unknown enum values, while still tolerating NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_source_enum_check'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_source_enum_check
      CHECK (source IS NULL OR source IN
        ('target','instagram','whatsapp','referral','organic','repeat','other'));
  END IF;
END$$;
