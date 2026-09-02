-- Migration 148: Make player primary_position nullable
--
-- Brand new Premier League arrivals (e.g. from FPL bootstrap) should not be
-- assigned a coarse fallback position (CB/CM/ST) before SoFIFA and Transfermarkt
-- have synced them. Dropping NOT NULL allows holding unmapped players with
-- NULL primary_position and NULL market_value until both sources sync.

ALTER TABLE public.players ALTER COLUMN primary_position DROP NOT NULL;

-- Reset unmapped active players who were assigned a coarse fallback without
-- SoFIFA mapping or Transfermarkt valuation (e.g., Bradley Barcola).
UPDATE public.players
SET primary_position = NULL
WHERE is_active = TRUE
  AND sofifa_common_name IS NULL
  AND (market_value_updated_at IS NULL OR market_value IS NULL OR market_value = 0)
  AND (name ILIKE '%Barcola%' OR web_name ILIKE '%Barcola%');
