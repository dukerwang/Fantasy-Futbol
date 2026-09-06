-- ============================================================
-- Migration 156: Cup ties survive the season reset
--
-- Until now a season reset destroyed every knockout result in the league.
-- `resetTournaments()` in src/lib/offseason/seasonReset.ts deletes
-- tournament_rounds and tournament_matchups by cascade, and the only thing
-- archiveCupWinners() saved was the winner's name. So "I knocked you out of
-- the Champions Cup semi-final" became unrecoverable one summer later, and
-- head-to-head records could only ever count league fixtures.
--
-- Heritage needs cup ties in the record. This table is where they go.
--
-- DENORMALISED ON PURPOSE. Migration 143 learned this the hard way: the
-- archive OUTLIVES its source rows, because resetTournaments() deletes the
-- tournaments immediately after the archive pass reads them. So the
-- competition name, its type, and the round's own shape are copied in as
-- values. Nothing here points at public.tournaments.
--
-- Keyed on (league_id, season, tournament_name, round_number,
-- bracket_position) — the tie's position in its bracket, which is stable and
-- unique within one competition in one season.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.season_cup_matchups_archive (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id          UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season             TEXT NOT NULL,

  -- The competition, copied as values (see the note above).
  tournament_name    TEXT NOT NULL,
  tournament_type    tournament_type NOT NULL,

  -- The round, likewise. `round_name` is the display label ('Semi-Final');
  -- `round_number` is 1-indexed from the first round.
  round_name         TEXT NOT NULL,
  round_number       INT NOT NULL,
  is_two_leg         BOOLEAN NOT NULL DEFAULT FALSE,
  start_gameweek     INT NOT NULL,
  end_gameweek       INT NOT NULL,
  bracket_position   INT NOT NULL DEFAULT 0,

  -- Teams stay real references: a club row is never deleted at a reset, and
  -- the cabinet and head-to-head both need to join on it.
  -- NULL on either side is a bye, exactly as in tournament_matchups.
  team_a_id          UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  team_b_id          UUID REFERENCES public.teams(id) ON DELETE CASCADE,

  team_a_score_leg1  NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_b_score_leg1  NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_a_score_leg2  NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_b_score_leg2  NUMERIC(8, 2) NOT NULL DEFAULT 0,
  winner_id          UUID REFERENCES public.teams(id) ON DELETE SET NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (league_id, season, tournament_name, round_number, bracket_position)
);

ALTER TABLE public.season_cup_matchups_archive ENABLE ROW LEVEL SECURITY;

-- Same shape as the other season archives, with auth.uid() wrapped in a
-- scalar subquery so it is evaluated once per query rather than per row
-- (migration 145).
CREATE POLICY "Season cup matchups archive: read if league member"
  ON public.season_cup_matchups_archive FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = season_cup_matchups_archive.league_id
        AND lm.user_id = (SELECT auth.uid())
    )
  );

-- The league-wide read (a season's brackets, the record book).
CREATE INDEX IF NOT EXISTS idx_cup_matchups_archive_league_season
  ON public.season_cup_matchups_archive (league_id, season);

-- The head-to-head read. Two indexes rather than one: a tie stores its clubs
-- in whichever order the bracket generated them, so a pairing lookup has to
-- match a club on either side.
CREATE INDEX IF NOT EXISTS idx_cup_matchups_archive_team_a
  ON public.season_cup_matchups_archive (league_id, team_a_id);
CREATE INDEX IF NOT EXISTS idx_cup_matchups_archive_team_b
  ON public.season_cup_matchups_archive (league_id, team_b_id);
