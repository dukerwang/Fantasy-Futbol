-- Migration 063: Update PPG and Form calculations to use a >= 15 minutes threshold

CREATE OR REPLACE FUNCTION public.update_player_form_ratings()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Update form_rating (average of last 3 match_ratings where minutes >= 15)
  UPDATE players p
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
      FROM player_stats
      WHERE season = '2025-26'
        AND match_rating IS NOT NULL
        AND (stats->>'minutes_played')::int >= 15
    ) ranked
    WHERE rn <= 3
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;

  -- 2. Update ppg (average fantasy_points for the season, excluding DNP and cameos < 15 mins)
  UPDATE players p
  SET ppg = sub.avg_pts
  FROM (
    SELECT
      player_id,
      ROUND(AVG(fantasy_points)::numeric, 1) AS avg_pts
    FROM player_stats
    WHERE season = '2025-26'
      AND fantasy_points IS NOT NULL
      AND (stats->>'minutes_played')::int >= 15
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_player_fantasy_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_season TEXT := '2025-26';
BEGIN
  -- 1. total_points sums all points regardless of minutes played
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
    -- 2. form averages the last 3 gameweeks where the player played >= 15 minutes
    form = COALESCE(
      (
        SELECT AVG(gw_pts)
        FROM (
          SELECT SUM(ps2.fantasy_points) AS gw_pts
          FROM player_stats ps2
          WHERE ps2.player_id = p.id
            AND ps2.season = current_season
            AND (ps2.stats->>'minutes_played')::int >= 15
          GROUP BY ps2.gameweek
          ORDER BY ps2.gameweek DESC
          LIMIT 3
        ) last3
      ),
      0
    )
  WHERE p.id IS NOT NULL;
END;
$$;

-- Recalculate stats for all players
SELECT update_player_fantasy_scores();
SELECT update_player_form_ratings();
