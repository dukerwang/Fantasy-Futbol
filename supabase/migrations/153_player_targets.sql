-- ============================================================
-- Migration 153: Targets — the demand side of the market
--
-- Listings (059/077/114) let a manager say what he will part with.
-- Nothing let him say what he is looking for, so demand was invisible
-- and the only way to signal interest was a complete offer.
--
-- A target is deliberately INERT: no floor, no clock, nothing to bid
-- on. It advertises, and the existing offer/listing machinery
-- transacts. `roster_entries.on_trade_block` (029, deprecated by 077)
-- failed by being a signal shaped like a mechanism — nothing honoured
-- it. What makes this different is the matching, not the tag.
--
-- Spec: docs/superpowers/specs/2026-09-04-targets-design.md
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_targets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  -- 'player' names a specific man; 'profile' names a position we need.
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('player', 'profile')),
  player_id     UUID REFERENCES public.players(id) ON DELETE CASCADE,

  -- Duplicates the GranularPosition union in src/types/index.ts, which
  -- stays the source of truth. This is a guard; the two move together.
  position      TEXT CHECK (position IN
                  ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LW','RW','ST')),

  -- 'private' is invisible to the whole league, RLS included. Its only
  -- output is an alert to its owner when the player becomes gettable.
  visibility    TEXT NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public', 'private')),

  -- What this club would GIVE. Mirrors the listing gates with the words
  -- reversed: open_to_sale here means "I'll pay cash", not "I want cash".
  open_to_sale  BOOLEAN NOT NULL DEFAULT TRUE,
  open_to_trade BOOLEAN NOT NULL DEFAULT FALSE,
  open_to_loan  BOOLEAN NOT NULL DEFAULT FALSE,

  budget        INTEGER CHECK (budget IS NULL OR budget >= 0),
  note          TEXT CHECK (note IS NULL OR char_length(note) <= 140),

  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'filled', 'withdrawn', 'expired')),

  -- Rolls off on a read filter — no sweeper job, nothing in vercel.json.
  -- 28 days, not the listing window's 72 hours: a target is a standing
  -- position, not an offer under a clock.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '28 days',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT player_targets_kind_shape CHECK (
    (target_kind = 'player'  AND player_id IS NOT NULL AND position  IS NULL) OR
    (target_kind = 'profile' AND position  IS NOT NULL AND player_id IS NULL)
  )
);

-- ── 2. Indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_player_targets_league_status
  ON public.player_targets (league_id, status, visibility);

CREATE INDEX IF NOT EXISTS idx_player_targets_player
  ON public.player_targets (player_id, status)
  WHERE player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_player_targets_position
  ON public.player_targets (league_id, position, status)
  WHERE position IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_player_targets_team
  ON public.player_targets (team_id, status);

-- One live target per club per player, and per club per position.
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_targets_one_active_player
  ON public.player_targets (league_id, team_id, player_id)
  WHERE status = 'active' AND player_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_targets_one_active_profile
  ON public.player_targets (league_id, team_id, position)
  WHERE status = 'active' AND position IS NOT NULL;

-- ── 3. RLS ───────────────────────────────────────────────────
--
-- Realtime honours RLS and the Targets board subscribes, so this
-- policy is the ONLY thing keeping a private target off the rest of
-- the league's wire. Client-side filtering is not a substitute.
--
-- (select auth.uid()) rather than a bare auth.uid(): the bare form
-- re-evaluates per row and trips the auth_rls_initplan lint that
-- migration 145 exists to fix.

ALTER TABLE public.player_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Targets: read public in league, private if mine"
  ON public.player_targets;

CREATE POLICY "Targets: read public in league, private if mine"
  ON public.player_targets FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = player_targets.league_id
        AND lm.user_id = (SELECT auth.uid())
    )
    AND (
      visibility = 'public'
      OR EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = player_targets.team_id
          AND t.user_id = (SELECT auth.uid())
      )
    )
  );

-- Writes go through the service-role client in the route handlers, as
-- listings do, so no INSERT/UPDATE/DELETE policies are needed.

-- ── 4. updated_at ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_player_targets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_targets_updated_at ON public.player_targets;
CREATE TRIGGER trg_player_targets_updated_at
  BEFORE UPDATE ON public.player_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_player_targets_updated_at();

-- ── 5. Realtime ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'player_targets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_targets;
  END IF;
END
$$;
