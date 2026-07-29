-- ============================================================
-- Migration 085: Make positional rank mean "best player AT that
-- position", and rank over the same pool the UI displays.
-- ============================================================
--
-- Two defects this fixes, both visible as a card reading "ST #4" while
-- the striker leaderboard shows that player 2nd:
--
--   1. POOL MISMATCH. archive_player_season_stats() (084) ranked over
--      public.players with no is_active filter, while every stats page
--      fetches .eq('is_active', true). For 2025-26 that handed ST ranks
--      2 and 3 to Jarrod Bowen and Igor Thiago, who left the league and
--      so never render in the table. 237 of 646 archived rows were in
--      the rank pool but invisible. player_rankings (033) filtered
--      is_active, so the live and archived rank sources also disagreed
--      with each other.
--
--   2. WRONG METRIC. Both rank sources took a player's single season
--      total and replicated it across their primary position AND every
--      secondary position. Bowen's 558 points were all earned at RW, yet
--      they ranked him 2nd among strikers. Meanwhile the leaderboard
--      re-scores secondary-position appearances under that position's
--      weights (calculateMatchRating) and counts only appearances of
--      >= 15 minutes, so the two numbers could never reconcile.
--
-- Re-scoring is the scoring engine's job and lives in TypeScript
-- (src/lib/scoring/matchRating.ts), which SQL cannot call. So positional
-- ranks stop being derived in SQL: they are computed by
-- recomputePositionRanks() (src/lib/stats/seasonStats.ts) and persisted
-- here — on players.position_ranks for the live season, and on
-- season_player_stats_archive.position_ranks for a completed one.
-- overall_rank is unchanged; it is a season total, and a season total is
-- position-independent.

-- ── 1. Persisted live positional ranks ──────────────────────────────
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS position_ranks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.players.position_ranks IS
  'Live-season positional ranks, [{"position":"ST","rank":2}], written by '
  'recomputePositionRanks() after each stats sync. Ranked on points scored '
  'AT each position (secondaries re-scored under that position''s weights), '
  'over active players only — the same pool the stats table renders.';

-- ── 2. player_rankings now reads the persisted ranks ────────────────
-- overall_rank is still derived live from players.total_points so it
-- stays correct between syncs.
DROP VIEW IF EXISTS public.player_rankings;

CREATE VIEW public.player_rankings AS
WITH valid_players AS (
  SELECT id, total_points, position_ranks
  FROM public.players
  WHERE is_active = true
)
SELECT
  id AS player_id,
  RANK() OVER (ORDER BY COALESCE(total_points, 0) DESC) AS overall_rank,
  COALESCE(position_ranks, '[]'::jsonb) AS position_ranks
FROM valid_players;

-- ── 3. Bulk writers for the recompute job ───────────────────────────
-- Both reset the whole scope first: a player who drops out of a position
-- pool (leaves the league, loses a secondary position, stops clearing 15
-- minutes) must lose the rank, not keep a stale one.

CREATE OR REPLACE FUNCTION public.apply_player_position_ranks(p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.players
  SET position_ranks = '[]'::jsonb
  WHERE position_ranks <> '[]'::jsonb;

  WITH payload AS (
    SELECT
      (e->>'player_id')::uuid AS player_id,
      COALESCE(e->'position_ranks', '[]'::jsonb) AS position_ranks
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) e
  ),
  upd AS (
    UPDATE public.players p
    SET position_ranks = pl.position_ranks
    FROM payload pl
    WHERE p.id = pl.player_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_archive_position_ranks(p_season TEXT, p_payload JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.season_player_stats_archive
  SET position_ranks = '[]'::jsonb
  WHERE season = p_season
    AND position_ranks <> '[]'::jsonb;

  WITH payload AS (
    SELECT
      (e->>'player_id')::uuid AS player_id,
      COALESCE(e->'position_ranks', '[]'::jsonb) AS position_ranks
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) e
  ),
  upd AS (
    UPDATE public.season_player_stats_archive a
    SET position_ranks = pl.position_ranks
    FROM payload pl
    WHERE a.player_id = pl.player_id
      AND a.season = p_season
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_player_position_ranks(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_archive_position_ranks(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 4. Archiving no longer invents positional ranks ─────────────────
-- Identical to 084 except that position_ranks is seeded empty on insert
-- and left untouched on conflict, so re-running the archive can never
-- clobber the re-scored ranks. recomputePositionRanks(season, 'archive')
-- fills them immediately afterwards (see seasonReset.ts).
CREATE OR REPLACE FUNCTION public.archive_player_season_stats(p_season TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.season_player_stats_archive (
    player_id,
    season,
    total_points,
    ppg,
    form_rating,
    overall_rank,
    position_ranks
  )
  SELECT
    p.id AS player_id,
    p_season AS season,
    COALESCE(agg.total_points, 0) AS total_points,
    COALESCE(agg.ppg, 0) AS ppg,
    COALESCE(form_agg.avg_rating, 0) AS form_rating,
    COALESCE(r.overall_rank, 9999) AS overall_rank,
    '[]'::jsonb AS position_ranks
  FROM public.players p
  LEFT JOIN (
    SELECT
      player_id,
      COALESCE(SUM(fantasy_points), 0) AS total_points,
      -- Meaningful-minutes PPG: avg over appearances with >= 15 minutes.
      COALESCE(
        ROUND(
          AVG(fantasy_points) FILTER (WHERE (stats->>'minutes_played')::int >= 15)::numeric,
          1
        ),
        0
      ) AS ppg
    FROM public.player_stats
    WHERE season = p_season
    GROUP BY player_id
  ) agg ON p.id = agg.player_id
  LEFT JOIN (
    SELECT
      player_id,
      ROUND(AVG(match_rating)::numeric, 1) AS avg_rating
    FROM (
      SELECT
        player_id,
        match_rating,
        ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY gameweek DESC) AS rn
      FROM player_stats
      WHERE season = p_season
        AND match_rating IS NOT NULL
        AND (stats->>'minutes_played')::int >= 15
    ) ranked
    WHERE rn <= 5
    GROUP BY player_id
  ) form_agg ON p.id = form_agg.player_id
  LEFT JOIN (
    -- overall_rank only: every player with points in the season, which is
    -- exactly who the archived leaderboard now renders.
    SELECT
      player_id,
      RANK() OVER (ORDER BY total_points DESC) AS overall_rank
    FROM (
      SELECT
        p2.id AS player_id,
        COALESCE(agg2.total_points, 0) AS total_points
      FROM public.players p2
      JOIN (
        SELECT
          player_id,
          SUM(fantasy_points) AS total_points
        FROM public.player_stats
        WHERE season = p_season
        GROUP BY player_id
      ) agg2 ON p2.id = agg2.player_id
    ) season_players
  ) r ON p.id = r.player_id
  WHERE agg.total_points > 0
  ON CONFLICT (player_id, season) DO UPDATE SET
    total_points   = EXCLUDED.total_points,
    ppg            = EXCLUDED.ppg,
    form_rating    = EXCLUDED.form_rating,
    overall_rank   = EXCLUDED.overall_rank;
    -- position_ranks deliberately preserved: owned by recomputePositionRanks().
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_player_season_stats(TEXT) FROM PUBLIC, anon, authenticated;
