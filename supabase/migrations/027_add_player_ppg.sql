-- Add ppg column to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS ppg FLOAT8;

-- Update update_player_form_ratings to also calculate PPG
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
    ) ranked
    WHERE rn <= 3
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;

  -- 2. Update PPG (total_points / matches_played)
  UPDATE players p
  SET ppg = CASE 
    WHEN stats.matches_played > 0 THEN ROUND((p.total_points::numeric / stats.matches_played), 2)
    ELSE 0 
  END
  FROM (
    SELECT 
      player_id, 
      COUNT(*) as matches_played
    FROM player_stats
    WHERE season = '2025-26'
      AND (stats->>'minutes_played')::int > 0
    GROUP BY player_id
  ) stats
  WHERE p.id = stats.player_id
    AND p.is_active = true;
END;
$$;
