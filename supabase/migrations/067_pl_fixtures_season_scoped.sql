-- ============================================================
-- Migration 067: Season-scoped, club-slug-keyed PL fixtures
-- ============================================================
--
-- PROBLEM
-- -------
-- pl_fixtures (migration 056) was keyed on FPL's `fixtures[].id` alone, and
-- referenced clubs by FPL's `teams[].id`. BOTH of those are reassigned every
-- season:
--
--   * fixture ids restart at 1-380 each season, so `upsert(onConflict: 'id')`
--     in /api/sync/stats overwrote last season's fixtures with this season's.
--   * team ids are assigned alphabetically over whichever 20 clubs are in the
--     division, so id 19 meant West Ham in 2025-26 and Spurs in 2026-27.
--
-- Net effect: the 2025-26 fixture list was destroyed at the summer rollover,
-- which is why every archived game log renders its opponent as "Unknown".
--
-- FIX
-- ---
-- Composite PK on (season, fpl_fixture_id), and clubs referenced by the stable
-- slug from src/lib/clubs/clubs.json rather than any seasonal integer. Scores
-- are stored too, so archived logs can show results without re-hitting FPL
-- (which no longer serves past-season fixtures at all).
--
-- The 10 surviving rows in the old table are 2025-26 GW38 only, with no scores
-- and season-ambiguous team ids, so they are not migrated — the backfill
-- repopulates the season properly.

DROP TABLE IF EXISTS public.pl_fixtures;

CREATE TABLE public.pl_fixtures (
  season          TEXT        NOT NULL,           -- "2025-26"
  fpl_fixture_id  INT         NOT NULL,           -- FPL id, unique only WITHIN a season
  gameweek        INT         NOT NULL,
  home_club       TEXT        NOT NULL,           -- stable slug, e.g. "west-ham"
  away_club       TEXT        NOT NULL,
  home_score      INT,                            -- null until played
  away_score      INT,
  finished        BOOLEAN     NOT NULL DEFAULT FALSE,
  kickoff_time    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, fpl_fixture_id),
  CONSTRAINT pl_fixtures_distinct_clubs CHECK (home_club <> away_club)
);

-- The game log resolves an opponent by (season, club, gameweek), never by
-- fixture id, so these two cover the read path.
CREATE INDEX pl_fixtures_season_gw_idx   ON public.pl_fixtures (season, gameweek);
CREATE INDEX pl_fixtures_season_home_idx ON public.pl_fixtures (season, home_club, gameweek);
CREATE INDEX pl_fixtures_season_away_idx ON public.pl_fixtures (season, away_club, gameweek);

ALTER TABLE public.pl_fixtures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all authenticated users"
  ON public.pl_fixtures FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Enable write access for service role only"
  ON public.pl_fixtures FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
