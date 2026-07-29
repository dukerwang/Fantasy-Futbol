-- ============================================================
-- Migration 084: Prevent duplicate GW appearances from
-- corrupting PPG / archive totals, and refresh archive rules.
-- ============================================================
--
-- Root cause: player_stats is UNIQUE (player_id, match_id), but sync
-- sometimes writes the same appearance under a real FPL fixture id AND
-- under a synthetic id (gameweek * 1000 + fpl_id). Aggregations that
-- sum/avg by row then double-count that gameweek (Estêvão GW7: +15 min,
-- +2.46 pts → archive PPG 7.9 vs live 8.2).
--
-- Real FPL fixture ids for a season sit well below 1000. Synthetic ids
-- are always >= 1000. Double gameweeks use two *real* fixture ids, so
-- they are unaffected by the synthetic unique index below.

-- 1a. Drop synthetic rows when a real FPL fixture row already covers that GW
--     (real fixture ids are < 1000; synthetics are gameweek*1000+fpl_id).
DELETE FROM public.player_stats ps
WHERE ps.match_id >= 1000
  AND EXISTS (
    SELECT 1
    FROM public.player_stats other
    WHERE other.player_id = ps.player_id
      AND other.season = ps.season
      AND other.gameweek = ps.gameweek
      AND other.match_id < 1000
  );

-- 1b. If multiple synthetics remain for the same GW (no real fixture row),
--     keep the best one. Do NOT touch multi-row GWs that are all real
--     fixture ids — those are legitimate double gameweeks.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY player_id, season, gameweek
      ORDER BY
        COALESCE((stats->>'minutes_played')::int, 0) DESC,
        COALESCE(fantasy_points, 0) DESC,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.player_stats
  WHERE match_id >= 1000
)
DELETE FROM public.player_stats ps
USING ranked r
WHERE ps.id = r.id
  AND r.rn > 1;

-- 2. At most one synthetic match_id row per player/season/gameweek.
CREATE UNIQUE INDEX IF NOT EXISTS player_stats_one_synthetic_per_gw
  ON public.player_stats (player_id, season, gameweek)
  WHERE match_id >= 1000;

-- 3. Archive every player who scored in the season — including relegated /
--    inactive — so offseason UI does not keep a stale snapshot for them.
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
    COALESCE(r.position_ranks, '[]'::jsonb) AS position_ranks
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
    WITH season_players AS (
      SELECT
        p2.id AS player_id,
        p2.primary_position,
        p2.secondary_positions,
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
    ),
    overall_ranks AS (
      SELECT
        player_id,
        RANK() OVER (ORDER BY total_points DESC) AS overall_rank
      FROM season_players
    ),
    flattened_positions AS (
      SELECT
        player_id,
        total_points,
        UNNEST(
          ARRAY[primary_position] || COALESCE(secondary_positions, '{}'::granular_position[])
        ) AS granular_pos
      FROM season_players
    ),
    positional_ranks AS (
      SELECT
        player_id,
        granular_pos,
        RANK() OVER (PARTITION BY granular_pos ORDER BY total_points DESC) AS pos_rank
      FROM flattened_positions
    ),
    agg_positional_ranks AS (
      SELECT
        player_id,
        jsonb_agg(jsonb_build_object('position', granular_pos, 'rank', pos_rank)) AS position_ranks
      FROM positional_ranks
      GROUP BY player_id
    )
    SELECT
      o.player_id,
      o.overall_rank,
      COALESCE(apr.position_ranks, '[]'::jsonb) AS position_ranks
    FROM overall_ranks o
    LEFT JOIN agg_positional_ranks apr ON o.player_id = apr.player_id
  ) r ON p.id = r.player_id
  WHERE agg.total_points > 0
  ON CONFLICT (player_id, season) DO UPDATE SET
    total_points   = EXCLUDED.total_points,
    ppg            = EXCLUDED.ppg,
    form_rating    = EXCLUDED.form_rating,
    overall_rank   = EXCLUDED.overall_rank,
    position_ranks = EXCLUDED.position_ranks;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_player_season_stats(TEXT) FROM PUBLIC, anon, authenticated;
