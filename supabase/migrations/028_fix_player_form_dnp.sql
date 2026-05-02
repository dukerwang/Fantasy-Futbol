-- Update update_player_form_ratings to exclude DNP games
CREATE OR REPLACE FUNCTION update_player_form_ratings()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Update form_rating (average of last 3 match_ratings)
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
        AND (stats->>'minutes_played')::int > 0
    ) ranked
    WHERE rn <= 3
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;

  -- 2. Update ppg (average fantasy_points for the season, excluding DNPs)
  UPDATE players p
  SET ppg = sub.avg_pts
  FROM (
    SELECT
      player_id,
      ROUND(AVG(fantasy_points)::numeric, 1) AS avg_pts
    FROM player_stats
    WHERE season = '2025-26'
      AND fantasy_points IS NOT NULL
      AND (stats->>'minutes_played')::int > 0
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;
END;
$$;
