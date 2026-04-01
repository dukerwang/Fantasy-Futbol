-- ============================================================
-- Fantasy Futbol — Tournament Schema (Phase 15)
-- Run this in your Supabase SQL editor AFTER 001_initial_schema.sql.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE tournament_type AS ENUM ('primary_cup', 'secondary_cup', 'consolation_cup');
CREATE TYPE tournament_status AS ENUM ('pending', 'active', 'completed');
CREATE TYPE tournament_matchup_status AS ENUM ('pending', 'active', 'completed');

-- ============================================================
-- TOURNAMENTS
-- ============================================================

CREATE TABLE public.tournaments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        tournament_type NOT NULL,
  status      tournament_status NOT NULL DEFAULT 'pending',
  season      TEXT NOT NULL DEFAULT '2025-26',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournaments_league ON public.tournaments(league_id);
CREATE INDEX idx_tournaments_status ON public.tournaments(status);

-- ============================================================
-- TOURNAMENT ROUNDS
-- ============================================================

CREATE TABLE public.tournament_rounds (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id   UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- e.g. 'Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'
  round_number    INT NOT NULL,           -- 1-indexed from first round
  start_gameweek  INT NOT NULL,
  end_gameweek    INT NOT NULL,           -- same as start for single-leg; start+1 for 2-leg
  is_two_leg      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournament_rounds_tournament ON public.tournament_rounds(tournament_id);

-- ============================================================
-- TOURNAMENT MATCHUPS
-- ============================================================

CREATE TABLE public.tournament_matchups (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id         UUID NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  team_a_id        UUID REFERENCES public.teams(id),   -- NULL = BYE / TBD
  team_b_id        UUID REFERENCES public.teams(id),   -- NULL = BYE / TBD
  team_a_score_leg1 NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_b_score_leg1 NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_a_score_leg2 NUMERIC(8, 2) NOT NULL DEFAULT 0,
  team_b_score_leg2 NUMERIC(8, 2) NOT NULL DEFAULT 0,
  winner_id        UUID REFERENCES public.teams(id),
  next_matchup_id  UUID REFERENCES public.tournament_matchups(id), -- winner advances here
  bracket_position INT NOT NULL DEFAULT 0,  -- position in the bracket for rendering
  status           tournament_matchup_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournament_matchups_round ON public.tournament_matchups(round_id);
CREATE INDEX idx_tournament_matchups_next ON public.tournament_matchups(next_matchup_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER update_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matchups ENABLE ROW LEVEL SECURITY;

-- Tournaments: league members can read
CREATE POLICY "Tournaments: read if league member" ON public.tournaments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Tournament rounds: readable if tournament is readable
CREATE POLICY "Tournament rounds: read if league member" ON public.tournament_rounds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments t
      JOIN public.league_members lm ON lm.league_id = t.league_id
      WHERE t.id = tournament_id AND lm.user_id = auth.uid()
    )
  );

-- Tournament matchups: readable if round is readable
CREATE POLICY "Tournament matchups: read if league member" ON public.tournament_matchups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tournament_rounds tr
      JOIN public.tournaments t ON t.id = tr.tournament_id
      JOIN public.league_members lm ON lm.league_id = t.league_id
      WHERE tr.id = round_id AND lm.user_id = auth.uid()
    )
  );
