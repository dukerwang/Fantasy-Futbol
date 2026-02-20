-- ============================================================
-- Fantasy Futbol — Initial Database Schema
-- Run this in your Supabase SQL editor or via supabase CLI.
-- ============================================================

-- ============================================================
-- TEARDOWN (safe to re-run: drops everything before recreating)
-- ============================================================

DROP TABLE IF EXISTS public.draft_picks       CASCADE;
DROP TABLE IF EXISTS public.waiver_claims     CASCADE;
DROP TABLE IF EXISTS public.transactions      CASCADE;
DROP TABLE IF EXISTS public.player_stats      CASCADE;
DROP TABLE IF EXISTS public.matchups          CASCADE;
DROP TABLE IF EXISTS public.roster_entries    CASCADE;
DROP TABLE IF EXISTS public.players           CASCADE;
DROP TABLE IF EXISTS public.teams             CASCADE;
DROP TABLE IF EXISTS public.league_members    CASCADE;
DROP TABLE IF EXISTS public.leagues           CASCADE;
DROP TABLE IF EXISTS public.users             CASCADE;

DROP TYPE IF EXISTS granular_position    CASCADE;
DROP TYPE IF EXISTS roster_status        CASCADE;
DROP TYPE IF EXISTS draft_type           CASCADE;
DROP TYPE IF EXISTS league_status        CASCADE;
DROP TYPE IF EXISTS matchup_status       CASCADE;
DROP TYPE IF EXISTS transaction_type     CASCADE;
DROP TYPE IF EXISTS waiver_claim_status  CASCADE;
DROP TYPE IF EXISTS acquisition_type     CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

-- ============================================================
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE granular_position AS ENUM (
  'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'
);

CREATE TYPE roster_status AS ENUM ('active', 'bench', 'ir');

CREATE TYPE draft_type AS ENUM ('snake', 'auction');

CREATE TYPE league_status AS ENUM ('setup', 'drafting', 'active', 'completed');

CREATE TYPE matchup_status AS ENUM ('scheduled', 'live', 'completed');

CREATE TYPE transaction_type AS ENUM (
  'waiver_claim',
  'free_agent_pickup',
  'drop',
  'trade',
  'transfer_compensation',
  'draft_pick'
);

CREATE TYPE waiver_claim_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE acquisition_type AS ENUM (
  'draft', 'waiver', 'free_agent', 'trade'
);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================

CREATE TABLE public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  username    TEXT NOT NULL UNIQUE,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LEAGUES
-- ============================================================

CREATE TABLE public.leagues (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  commissioner_id  UUID NOT NULL REFERENCES public.users(id),
  season           TEXT NOT NULL DEFAULT '2024-25',
  max_teams        INT NOT NULL DEFAULT 12,
  roster_size      INT NOT NULL DEFAULT 15,
  bench_size       INT NOT NULL DEFAULT 4,
  faab_budget      INT NOT NULL DEFAULT 100,
  draft_type       draft_type NOT NULL DEFAULT 'snake',
  scoring_rules    JSONB NOT NULL DEFAULT '{
    "goal": 6,
    "assist": 4,
    "shot_on_target": 1,
    "key_pass": 2,
    "big_chance_created": 3,
    "successful_dribble": 1,
    "pass_completion_tier_1": 2,
    "pass_completion_tier_2": 1,
    "tackle_won": 1,
    "interception": 1,
    "clearance": 0.5,
    "clean_sheet_gk": 6,
    "clean_sheet_cb": 5,
    "clean_sheet_fb": 4,
    "clean_sheet_dm": 2,
    "yellow_card": -1,
    "red_card": -3,
    "own_goal": -2,
    "penalty_missed": -2,
    "save": 1,
    "penalty_save": 5,
    "goals_conceded_per_2": -1,
    "minutes_played_60": 2,
    "minutes_played_45": 1
  }',
  is_dynasty       BOOLEAN NOT NULL DEFAULT TRUE,
  status           league_status NOT NULL DEFAULT 'setup',
  invite_code      TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LEAGUE MEMBERS (junction)
-- ============================================================

CREATE TABLE public.league_members (
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league_id, user_id)
);

-- ============================================================
-- TEAMS
-- ============================================================

CREATE TABLE public.teams (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_name    TEXT NOT NULL,
  faab_budget  INT NOT NULL DEFAULT 100,
  total_points NUMERIC(8, 2) NOT NULL DEFAULT 0,
  draft_order  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, user_id),
  UNIQUE (league_id, team_name)
);

-- ============================================================
-- PLAYERS
-- ============================================================

CREATE TABLE public.players (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_football_id         INT UNIQUE,
  transfermarkt_id        TEXT UNIQUE,
  name                    TEXT NOT NULL,
  full_name               TEXT,
  date_of_birth           DATE,
  nationality             TEXT,
  pl_team                 TEXT NOT NULL,
  pl_team_id              INT,
  primary_position        granular_position NOT NULL,
  secondary_positions     granular_position[] NOT NULL DEFAULT '{}',
  market_value            NUMERIC(10, 2) NOT NULL DEFAULT 0, -- millions EUR
  market_value_updated_at TIMESTAMPTZ,
  photo_url               TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_pl_team ON public.players(pl_team);
CREATE INDEX idx_players_primary_position ON public.players(primary_position);
CREATE INDEX idx_players_is_active ON public.players(is_active);
CREATE INDEX idx_players_api_football_id ON public.players(api_football_id);

-- ============================================================
-- ROSTER ENTRIES
-- ============================================================

CREATE TABLE public.roster_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id           UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status            roster_status NOT NULL DEFAULT 'bench',
  acquisition_type  acquisition_type NOT NULL,
  acquisition_value NUMERIC(8, 2),
  acquired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, team_id)
);

CREATE INDEX idx_roster_entries_team_id ON public.roster_entries(team_id);
CREATE INDEX idx_roster_entries_player_id ON public.roster_entries(player_id);

-- ============================================================
-- MATCHUPS
-- ============================================================

CREATE TABLE public.matchups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id  UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  gameweek   INT NOT NULL,
  team_a_id  UUID NOT NULL REFERENCES public.teams(id),
  team_b_id  UUID NOT NULL REFERENCES public.teams(id),
  score_a    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  score_b    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  lineup_a   JSONB,
  lineup_b   JSONB,
  status     matchup_status NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, gameweek, team_a_id, team_b_id),
  CHECK (team_a_id <> team_b_id)
);

CREATE INDEX idx_matchups_league_gameweek ON public.matchups(league_id, gameweek);

-- ============================================================
-- PLAYER STATS (per match)
-- ============================================================

CREATE TABLE public.player_stats (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id       UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  match_id        INT NOT NULL, -- API-Football match ID
  gameweek        INT NOT NULL,
  season          TEXT NOT NULL DEFAULT '2024-25',
  stats           JSONB NOT NULL DEFAULT '{}',
  fantasy_points  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, match_id)
);

CREATE INDEX idx_player_stats_player_id ON public.player_stats(player_id);
CREATE INDEX idx_player_stats_gameweek ON public.player_stats(gameweek);
CREATE INDEX idx_player_stats_season ON public.player_stats(season);

-- ============================================================
-- TRANSACTIONS
-- ============================================================

CREATE TABLE public.transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id           UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id           UUID REFERENCES public.players(id) ON DELETE SET NULL,
  type                transaction_type NOT NULL,
  faab_bid            INT,
  compensation_amount NUMERIC(10, 2),
  notes               TEXT,
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_league_id ON public.transactions(league_id);
CREATE INDEX idx_transactions_team_id ON public.transactions(team_id);

-- ============================================================
-- WAIVER CLAIMS
-- ============================================================

CREATE TABLE public.waiver_claims (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id      UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id        UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  drop_player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  faab_bid       INT NOT NULL DEFAULT 0,
  priority       INT NOT NULL DEFAULT 999,
  status         waiver_claim_status NOT NULL DEFAULT 'pending',
  gameweek       INT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_waiver_claims_league_gameweek ON public.waiver_claims(league_id, gameweek);

-- ============================================================
-- DRAFT PICKS
-- ============================================================

CREATE TABLE public.draft_picks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id  UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  round      INT NOT NULL,
  pick       INT NOT NULL, -- overall pick number
  picked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, round, pick)
);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leagues_updated_at
  BEFORE UPDATE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

-- Users: can read anyone, write only own row
CREATE POLICY "Users: read all" ON public.users FOR SELECT USING (TRUE);
CREATE POLICY "Users: update own" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Players: public read (it's a reference table)
CREATE POLICY "Players: read all" ON public.players FOR SELECT USING (TRUE);

-- Player stats: public read
CREATE POLICY "Player stats: read all" ON public.player_stats FOR SELECT USING (TRUE);

-- Leagues: members can read their leagues
CREATE POLICY "Leagues: read if member" ON public.leagues FOR SELECT
  USING (
    auth.uid() = commissioner_id
    OR EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = id AND lm.user_id = auth.uid()
    )
  );

CREATE POLICY "Leagues: create" ON public.leagues FOR INSERT
  WITH CHECK (auth.uid() = commissioner_id);

CREATE POLICY "Leagues: update if commissioner" ON public.leagues FOR UPDATE
  USING (auth.uid() = commissioner_id);

-- League members
CREATE POLICY "League members: read" ON public.league_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Teams: league members can read all teams in their leagues
CREATE POLICY "Teams: read if league member" ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

CREATE POLICY "Teams: update own" ON public.teams FOR UPDATE
  USING (auth.uid() = user_id);

-- Roster entries: league members can read; team owner can write
CREATE POLICY "Roster: read if league member" ON public.roster_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.league_members lm ON lm.league_id = t.league_id
      WHERE t.id = team_id AND lm.user_id = auth.uid()
    )
  );

-- Matchups: league members can read
CREATE POLICY "Matchups: read if league member" ON public.matchups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Transactions: league members can read
CREATE POLICY "Transactions: read if league member" ON public.transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );

-- Waiver claims: team owner can read/write their own
CREATE POLICY "Waiver claims: read own" ON public.waiver_claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_id AND t.user_id = auth.uid()
    )
  );

-- Draft picks: league members can read
CREATE POLICY "Draft picks: read if league member" ON public.draft_picks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_id AND lm.user_id = auth.uid()
    )
  );
