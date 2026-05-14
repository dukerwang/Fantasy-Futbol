-- Migration 039: Shadow columns for scoring engine v2 validation.
--
-- Phase 1 of the scoring rebalance fixed several bugs:
--   - Granular defensive stats (tackles, CBI, recoveries, defensive_contribution)
--     now reach the engine instead of being hard-zeroed
--   - Per-position defensive reference stats recomputed from real data
--     (old baseline was a hardcoded {median: 0.2, stddev: 2.8} for all positions)
--   - LWB/RWB integrated everywhere (engine, reference stats, e2e seed)
--   - defensive_contribution (25/26+) folded into the defensive raw input
--
-- Phase 2 added role-aware scoring at matchup resolution: a bench RB subbed
-- into LB is now scored at LB weights for that matchup.
--
-- This migration adds shadow columns so the new engine ("v2") can run in
-- parallel with the old engine ("v1") for the remaining GWs of 25/26. The
-- offseason backfill (Phase 3C) populates v2 for past GWs by re-fetching FPL
-- live data. After review (Phase 3D), v2 promotes to primary and these
-- shadow columns are dropped before 26/27.
--
-- Columns are nullable; absence means "v2 not yet computed for this row".

ALTER TABLE public.player_stats
  ADD COLUMN IF NOT EXISTS match_rating_v2    NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS fantasy_points_v2  NUMERIC(6,2);

ALTER TABLE public.matchups
  ADD COLUMN IF NOT EXISTS score_a_v2  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS score_b_v2  NUMERIC(6,2);

COMMENT ON COLUMN public.player_stats.match_rating_v2   IS 'Scoring engine v2 shadow (Phase 3 rebalance). Compare to match_rating before promotion.';
COMMENT ON COLUMN public.player_stats.fantasy_points_v2 IS 'Scoring engine v2 shadow (Phase 3 rebalance). Compare to fantasy_points before promotion.';
COMMENT ON COLUMN public.matchups.score_a_v2 IS 'Role-aware v2 matchup score (Phase 3 rebalance). Compare to score_a before promotion.';
COMMENT ON COLUMN public.matchups.score_b_v2 IS 'Role-aware v2 matchup score (Phase 3 rebalance). Compare to score_b before promotion.';
