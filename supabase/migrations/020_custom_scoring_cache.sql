-- ============================================================
-- 020_custom_scoring_cache.sql
-- Replace FPL-sourced scoring columns with our custom engine's
-- calculated scores, cached directly on the players table for
-- performant global sorting.
-- ============================================================

-- 1. Drop the FPL-specific columns we no longer use
ALTER TABLE players
  DROP COLUMN IF EXISTS fpl_total_points,
  DROP COLUMN IF EXISTS fpl_form;

-- 2. Add our custom scoring cache columns
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS total_points NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS form         NUMERIC DEFAULT 0;

-- 3. Create (or replace) the bulk-update function.
--    Calculates from player_stats:
--      total_points : SUM of fantasy_points across the season
--      form         : AVG fantasy_points over the last 3 played gameweeks
CREATE OR REPLACE FUNCTION update_player_fantasy_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_season TEXT := '2025-26';
BEGIN
  UPDATE players p
  SET
    total_points = COALESCE(
      (
        SELECT SUM(ps.fantasy_points)
        FROM player_stats ps
        WHERE ps.player_id = p.id
          AND ps.season = current_season
      ),
      0
    ),
    form = COALESCE(
      (
        SELECT AVG(gw_pts)
        FROM (
          SELECT SUM(ps2.fantasy_points) AS gw_pts
          FROM player_stats ps2
          WHERE ps2.player_id = p.id
            AND ps2.season = current_season
          GROUP BY ps2.gameweek
          ORDER BY ps2.gameweek DESC
          LIMIT 3
        ) last3
      ),
      0
    );
END;
$$;
