-- Migration 040: Promote scoring engine V2 → primary.
--
-- ⚠️ DO NOT APPLY UNTIL the user has signed off on the v2 deltas in
-- /admin/scoring-v2 for the entire 25/26 season (Phase 3D sign-off).
--
-- This migration is the final step of the scoring rebalance:
--   1. Copies v2 columns → primary columns for every row where v2 was
--      populated by the dual-write / offseason backfill.
--   2. Re-derives downstream caches (players.total_points, players.form,
--      players.ppg, players.form_rating) from the new fantasy_points.
--   3. Recomputes matchup winner_team_id based on the new scores (some draws
--      will flip to wins and vice versa under the >10 gap rule).
--   4. Drops the v2 shadow columns.
--   5. Code cleanup (delete src/lib/scoring/matchRatingV1Legacy.ts and remove
--      dual-write in /api/sync/stats) is performed in the same PR — see
--      CLAUDE.md "Phase 3D promotion" runbook.
--
-- After this migration runs, `league_standings` (a VIEW over matchups) will
-- automatically reflect the new league_points. The view does NOT need a
-- separate recompute because it derives league_points on each query from
-- matchups.score_a/score_b.

BEGIN;

-- 1. Player-stat scores: v2 → primary (only where backfilled)
UPDATE public.player_stats
SET
  match_rating  = match_rating_v2,
  fantasy_points = fantasy_points_v2
WHERE match_rating_v2 IS NOT NULL
  AND fantasy_points_v2 IS NOT NULL;

-- 2. Matchup scores: v2 → primary (only where backfilled). Re-derive winner
--    using the same >10 gap rule as the live processor.
UPDATE public.matchups
SET
  score_a = score_a_v2,
  score_b = score_b_v2,
  winner_team_id = CASE
    WHEN status = 'completed' AND ABS(COALESCE(score_a_v2, 0) - COALESCE(score_b_v2, 0)) > 10 THEN
      CASE WHEN score_a_v2 > score_b_v2 THEN team_a_id ELSE team_b_id END
    WHEN status = 'completed' THEN NULL  -- draw under new scores
    ELSE winner_team_id                  -- live / scheduled: leave alone
  END
WHERE score_a_v2 IS NOT NULL
  AND score_b_v2 IS NOT NULL;

-- 3. Refresh players.total_points / form / ppg / form_rating from new scores.
SELECT update_player_fantasy_scores();
SELECT update_player_form_ratings();

-- 4. Drop the shadow columns. After this, scoring-v2 page will gracefully
--    show "no v2 data yet" until the next rebalance (none planned).
ALTER TABLE public.player_stats
  DROP COLUMN IF EXISTS match_rating_v2,
  DROP COLUMN IF EXISTS fantasy_points_v2;

ALTER TABLE public.matchups
  DROP COLUMN IF EXISTS score_a_v2,
  DROP COLUMN IF EXISTS score_b_v2;

COMMIT;
