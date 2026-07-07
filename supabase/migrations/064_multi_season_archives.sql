-- ============================================================
-- Migration 064: Multi-Season Archives & Dynamic Scoring RPCs
-- Adds: season_matchups_archive, season_cup_winners_archive,
--       season_player_stats_archive.
-- Replaces: update_player_form_ratings() and update_player_fantasy_scores()
--           to support a dynamic season parameter.
-- ============================================================

-- ── 1. Create season_matchups_archive ────────────────────────
CREATE TABLE IF NOT EXISTS public.season_matchups_archive (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season      TEXT NOT NULL,
  gameweek    INT NOT NULL,
  team_a_id   UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  team_b_id   UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  score_a     NUMERIC(8, 2) NOT NULL DEFAULT 0,
  score_b     NUMERIC(8, 2) NOT NULL DEFAULT 0,
  lineup_a    JSONB,
  lineup_b    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, season, gameweek, team_a_id, team_b_id)
);

ALTER TABLE public.season_matchups_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Season matchups archive: read if league member"
  ON public.season_matchups_archive FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = season_matchups_archive.league_id
        AND lm.user_id = auth.uid()
    )
  );

-- ── 2. Create season_cup_winners_archive ────────────────────
CREATE TABLE IF NOT EXISTS public.season_cup_winners_archive (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id       UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season          TEXT NOT NULL,
  tournament_name TEXT NOT NULL,
  winner_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, season, tournament_name)
);

ALTER TABLE public.season_cup_winners_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Season cup winners archive: read if league member"
  ON public.season_cup_winners_archive FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = season_cup_winners_archive.league_id
        AND lm.user_id = auth.uid()
    )
  );

-- ── 3. Create season_player_stats_archive ───────────────────
CREATE TABLE IF NOT EXISTS public.season_player_stats_archive (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season          TEXT NOT NULL,
  total_points    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  ppg             NUMERIC(4, 2) NOT NULL DEFAULT 0,
  form_rating     NUMERIC(3, 1) NOT NULL DEFAULT 0,
  overall_rank    INT NOT NULL,
  position_ranks  JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, season)
);

ALTER TABLE public.season_player_stats_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Player season archive: read all"
  ON public.season_player_stats_archive FOR SELECT
  USING (TRUE);

-- ── 4. Create player season stats archiving function ────────
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
    COALESCE(p.total_points, 0) AS total_points,
    COALESCE(p.ppg, 0) AS ppg,
    COALESCE(p.form_rating, 0) AS form_rating,
    COALESCE(r.overall_rank, 9999) AS overall_rank,
    COALESCE(r.position_ranks, '[]'::jsonb) AS position_ranks
  FROM public.players p
  LEFT JOIN public.player_rankings r ON p.id = r.player_id
  WHERE p.is_active = true
  ON CONFLICT (player_id, season) DO UPDATE SET
    total_points   = EXCLUDED.total_points,
    ppg            = EXCLUDED.ppg,
    form_rating    = EXCLUDED.form_rating,
    overall_rank   = EXCLUDED.overall_rank,
    position_ranks = EXCLUDED.position_ranks;
END;
$$;
-- Grant execute permissions (mirrors custom scoring functions)
REVOKE EXECUTE ON FUNCTION public.archive_player_season_stats(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 5. Re-define update_player_form_ratings with season parameter ──
CREATE OR REPLACE FUNCTION public.update_player_form_ratings(p_season TEXT DEFAULT '2025-26')
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Reset all players to 0 for these metrics first (so players with no games in p_season are cleared)
  UPDATE public.players SET form_rating = 0, ppg = 0;

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
      WHERE season = p_season
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
    WHERE season = p_season
      AND fantasy_points IS NOT NULL
      AND (stats->>'minutes_played')::int >= 15
    GROUP BY player_id
  ) sub
  WHERE p.id = sub.player_id
    AND p.is_active = true;
END;
$$;

-- ── 6. Re-define update_player_fantasy_scores with season parameter ──
CREATE OR REPLACE FUNCTION public.update_player_fantasy_scores(p_season TEXT DEFAULT '2025-26')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. total_points sums all points regardless of minutes played
  UPDATE players p
  SET
    total_points = COALESCE(
      (
        SELECT SUM(ps.fantasy_points)
        FROM player_stats ps
        WHERE ps.player_id = p.id
          AND ps.season = p_season
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
            AND ps2.season = p_season
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
