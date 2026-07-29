-- Migration 086: Ensure form_rating is computed over the last 5 qualifying
-- appearances (L5), not 3. Earlier migrations (026–063) used rn <= 3; 064
-- updated to rn <= 5 but the change may not have reached all environments.
-- This migration re-declares the function explicitly at L5 and re-runs it.

CREATE OR REPLACE FUNCTION public.update_player_form_ratings(p_season TEXT DEFAULT '2025-26')
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Reset so players with no qualifying games in p_season read 0, not stale.
  UPDATE public.players SET form_rating = 0, ppg = 0 WHERE id IS NOT NULL;

  -- 1. form_rating = average match_rating over the last 5 appearances
  --    where the player played >= 15 minutes (L5, matching the UI label).
  UPDATE public.players p
  SET form_rating = sub.avg_rating
  FROM (
    SELECT
      player_id,
      ROUND(AVG(match_rating)::numeric, 1) AS avg_rating
    FROM (
      SELECT
        player_id,
        match_rating,
        ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY gameweek DESC) AS rn
      FROM public.player_stats
      WHERE season = p_season
        AND match_rating IS NOT NULL
        AND (stats->>'minutes_played')::int >= 15
    ) ranked
    WHERE rn <= 5   -- L5: last 5 qualifying appearances
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;

  -- 2. ppg = average fantasy_points over all appearances >= 15 minutes
  --    (season-long, not windowed — unchanged from prior migrations).
  UPDATE public.players p
  SET ppg = sub.avg_pts
  FROM (
    SELECT
      player_id,
      ROUND(AVG(fantasy_points)::numeric, 1) AS avg_pts
    FROM public.player_stats
    WHERE season = p_season
      AND fantasy_points IS NOT NULL
      AND (stats->>'minutes_played')::int >= 15
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;
END;
$$;

-- Recompute immediately so the column is consistent with the new window.
SELECT public.update_player_form_ratings('2025-26');
