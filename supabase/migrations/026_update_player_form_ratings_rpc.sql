-- Create RPC to recompute form_rating for all active players.
-- form_rating = average match_rating over the last 3 non-DNP appearances.
CREATE OR REPLACE FUNCTION update_player_form_ratings()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
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
END;
$$;
