-- ============================================================
-- Migration 036: Offseason Infrastructure
-- Adds: pl_status/pl_season on players, season_transitions audit table,
--       season_standings_archive, offseason columns on leagues,
--       prize_config JSONB, league_status extensions,
--       transaction_type extension, credit_faab_prize RPC.
-- ============================================================

-- ── Players: relegation tracking ─────────────────────────────

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS pl_status TEXT NOT NULL DEFAULT 'active'
    CHECK (pl_status IN ('active', 'relegated', 'unknown'));

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS pl_season TEXT DEFAULT '2025-26';

-- Fix stale season default in existing schema
ALTER TABLE public.leagues
  ALTER COLUMN season SET DEFAULT '2025-26';

-- ── Season transition audit log ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.season_transitions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id     UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  season_from   TEXT NOT NULL,
  season_to     TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'relegated', 'promoted', 'transferred_out', 'transferred_in'
  )),
  player_id     UUID REFERENCES public.players(id) ON DELETE SET NULL,
  team_id       UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  team_name     TEXT,
  notes         TEXT,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_season_transitions_league
  ON public.season_transitions(league_id);
CREATE INDEX IF NOT EXISTS idx_season_transitions_player
  ON public.season_transitions(player_id);

-- RLS
ALTER TABLE public.season_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Season transitions: read if league member"
  ON public.season_transitions FOR SELECT
  USING (
    league_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = season_transitions.league_id
        AND lm.user_id = auth.uid()
    )
  );

-- ── Final standings archive ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.season_standings_archive (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season       TEXT NOT NULL,
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  final_rank   INT NOT NULL,
  total_points NUMERIC(8, 2) NOT NULL,
  archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, season, team_id)
);

ALTER TABLE public.season_standings_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Season archive: read if league member"
  ON public.season_standings_archive FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = season_standings_archive.league_id
        AND lm.user_id = auth.uid()
    )
  );

-- ── League: offseason columns ─────────────────────────────────

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS current_season TEXT NOT NULL DEFAULT '2025-26';

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS previous_season TEXT DEFAULT '2024-25';

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS roster_locked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS faab_budget INT NOT NULL DEFAULT 250;
-- Note: teams.faab_budget keeps per-team budget; leagues.faab_budget is the
-- starting budget for new teams created in this league.

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS prize_config JSONB NOT NULL DEFAULT '{
    "season_1st": 90,
    "season_2nd": 80,
    "season_3rd": 73,
    "season_4th": 68,
    "season_5th": 64,
    "season_6th": 62,
    "season_7th": 59,
    "season_8th": 57,
    "season_9th": 54,
    "season_10th": 52,
    "champions_cup_winner": 70,
    "champions_cup_runner_up": 25,
    "consolation_cup_winner": 40,
    "consolation_cup_runner_up": 15,
    "league_cup_winner": 40,
    "league_cup_runner_up": 10
  }';

-- ── Extend league_status enum ─────────────────────────────────

-- Postgres doesn't allow IF NOT EXISTS on enum values before PG12 IIRC,
-- but PG14+ (Supabase) supports it. Use DO block for safety.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'offseason'
      AND enumtypid = 'public.league_status'::regtype
  ) THEN
    ALTER TYPE public.league_status ADD VALUE 'offseason';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pre_draft'
      AND enumtypid = 'public.league_status'::regtype
  ) THEN
    ALTER TYPE public.league_status ADD VALUE 'pre_draft';
  END IF;
END $$;

-- ── Extend transaction_type enum ──────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'prize_payout'
      AND enumtypid = 'public.transaction_type'::regtype
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'prize_payout';
  END IF;
END $$;

-- ── RPC: credit_faab_prize ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.credit_faab_prize(
  p_team_id   UUID,
  p_amount    INT,
  p_prize_name TEXT,
  p_league_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.teams
  SET faab_budget  = faab_budget + p_amount,
      updated_at   = NOW()
  WHERE id = p_team_id;

  INSERT INTO public.transactions (
    league_id, team_id, type, faab_bid, notes, processed_at, created_at
  ) VALUES (
    p_league_id,
    p_team_id,
    'prize_payout',
    p_amount,
    p_prize_name,
    NOW(),
    NOW()
  );
END;
$$;
