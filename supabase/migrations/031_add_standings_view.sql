-- Final Standing View Fix: Include team names and usernames for easy querying.
-- Also uses ROW_NUMBER for deterministic ranking.
CREATE OR REPLACE VIEW league_standings AS
WITH matchup_results AS (
  SELECT
    league_id, team_a_id AS team_id,
    COALESCE(score_a, 0) AS pf, COALESCE(score_b, 0) AS pa,
    CASE 
      WHEN ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) <= 10 THEN 1 
      WHEN COALESCE(score_a, 0) > COALESCE(score_b, 0) THEN 3 
      ELSE 0 
    END AS points,
    CASE WHEN ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) <= 10 THEN 1 ELSE 0 END AS draws,
    CASE WHEN COALESCE(score_a, 0) > COALESCE(score_b, 0) AND ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) > 10 THEN 1 ELSE 0 END AS wins,
    CASE WHEN COALESCE(score_b, 0) > COALESCE(score_a, 0) AND ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) > 10 THEN 1 ELSE 0 END AS losses
  FROM matchups
  WHERE status IN ('live', 'completed') AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
  UNION ALL
  SELECT
    league_id, team_b_id AS team_id,
    COALESCE(score_b, 0) AS pf, COALESCE(score_a, 0) AS pa,
    CASE 
      WHEN ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) <= 10 THEN 1 
      WHEN COALESCE(score_b, 0) > COALESCE(score_a, 0) THEN 3 
      ELSE 0 
    END AS points,
    CASE WHEN ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) <= 10 THEN 1 ELSE 0 END AS draws,
    CASE WHEN COALESCE(score_b, 0) > COALESCE(score_a, 0) AND ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) > 10 THEN 1 ELSE 0 END AS wins,
    CASE WHEN COALESCE(score_a, 0) > COALESCE(score_b, 0) AND ABS(COALESCE(score_a, 0) - COALESCE(score_b, 0)) > 10 THEN 1 ELSE 0 END AS losses
  FROM matchups
  WHERE status IN ('live', 'completed') AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
),
team_totals AS (
  SELECT
    league_id, team_id, COUNT(*) AS played,
    SUM(points) AS league_points, SUM(wins) AS wins, SUM(draws) AS draws, SUM(losses) AS losses,
    SUM(pf) AS points_for, SUM(pa) AS points_against, SUM(pf - pa) AS goal_difference
  FROM matchup_results
  GROUP BY league_id, team_id
)
SELECT
  t.league_id, t.id AS team_id, t.team_name, u.username,
  COALESCE(tt.played, 0) AS played,
  COALESCE(tt.league_points, 0) AS league_points,
  COALESCE(tt.wins, 0) AS wins,
  COALESCE(tt.draws, 0) AS draws,
  COALESCE(tt.losses, 0) AS losses,
  COALESCE(tt.points_for, 0) AS points_for,
  COALESCE(tt.points_against, 0) AS points_against,
  COALESCE(tt.goal_difference, 0) AS goal_difference,
  ROW_NUMBER() OVER (
    PARTITION BY t.league_id 
    ORDER BY 
      COALESCE(tt.league_points, 0) DESC, 
      COALESCE(tt.goal_difference, 0) DESC, 
      COALESCE(tt.points_for, 0) DESC,
      t.team_name ASC -- Tiebreaker
  ) AS rank
FROM teams t
JOIN users u ON t.user_id = u.id
LEFT JOIN team_totals tt ON t.id = tt.team_id;
