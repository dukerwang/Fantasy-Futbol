-- Gaffa — Migration 072: the Retained List
--
-- When a player leaves the Premier League his owner was paid market value
-- automatically and the player vanished from the roster. The manager had no
-- say, which caused two problems:
--
--   1. A player paid out at Kickoff can sign for a PL club before the window
--      shuts three weeks later. The ex-owner then holds a windfall equal to
--      that player's value AND can bid it on him at the return auction — a
--      free option nobody else in the league has. This is not an edge case:
--      an established PL player at a relegated club is the single most likely
--      profile to be bought back up.
--   2. The forced sale felt like something the game did to you overnight.
--
-- Managers now choose, per departure:
--   RELEASE  — take the compensation. Player enters the auction pool.
--   RETAIN   — forfeit the compensation, keep his rights. He is off the roster
--              but still yours; if he ever returns to the PL he reverts to you
--              without an auction.
--
-- Retention is constrained by scarce slots (leagues.retained_slots) rather than
-- by an expiry clock. A timer would be arbitrary — nobody can know when a
-- player comes back — whereas slot scarcity makes holding one claim cost you
-- the ability to hold another. Rights are relinquishable for nothing (the
-- release valve that makes no-expiry workable) but never cashable, which would
-- reopen "retain everything, cash out whatever doesn't return".
--
-- Rights deliberately do NOT live in roster_entries. A retained player is
-- genuinely not a squad member — he is not even in the competition — and the
-- roster-size exclusion lists ('ir','taxi','loan_in'...) are duplicated across
-- thirteen call sites in TypeScript and SQL that already disagree with each
-- other. Threading a new status through all of them to represent someone who
-- isn't on the roster would be both dishonest and fragile.

-- ── 1. Decision lifecycle ────────────────────────────────────────────────────
--
--   pending         departure detected, awaiting the manager's choice
--   released        compensation paid, player gone            (terminal)
--   retained        holding rights, player outside the PL
--   return_pending  retained player is back in the PL, awaiting reinstatement
--   returned        reinstated to the roster                  (terminal)
--   relinquished    rights abandoned for nothing              (terminal)
--   lapsed          return window expired, player auctioned   (terminal)
--
-- A player departing again after being reinstated is a NEW row, not a reopened
-- one. That distinction is the whole point: the old compensation RPC keyed
-- idempotency on (league, team, player) with no notion of which departure, so a
-- re-signed player who left a second time paid his owner nothing, silently.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'departure_decision_status') THEN
    CREATE TYPE public.departure_decision_status AS ENUM (
      'pending',
      'released',
      'retained',
      'return_pending',
      'returned',
      'relinquished',
      'lapsed'
    );
  END IF;
END $$;

-- Reinstated players re-enter the roster under their own acquisition type, so
-- the history distinguishes "my retained rights matured" from an ordinary
-- free-agent pickup. Added here rather than alongside the RPC that writes it
-- (migration 073) because Postgres refuses to use a new enum value in the same
-- transaction that adds it — this needs to be committed first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'acquisition_type' AND e.enumlabel = 'retained_return'
  ) THEN
    ALTER TYPE public.acquisition_type ADD VALUE 'retained_return';
  END IF;
END $$;

-- ── 2. Per-league retained slot allowance ────────────────────────────────────
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS retained_slots INT NOT NULL DEFAULT 3;

ALTER TABLE public.leagues
  DROP CONSTRAINT IF EXISTS leagues_retained_slots_range;

ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_retained_slots_range
  CHECK (retained_slots >= 0 AND retained_slots <= 25);

COMMENT ON COLUMN public.leagues.retained_slots IS
  'How many departed players one team may hold the rights to at once. The scarcity constraint that replaces an expiry clock on retained rights.';

-- ── 3. Decisions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departure_decisions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id                 UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,

  -- Current rights holder. Moves on trade; equals original_team_id until then.
  team_id                   UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Who owned the player when he departed. Never changes. This is the identity
  -- the buy-back exclusion is enforced against: a manager who took the cash
  -- cannot then bid on the same player's return auction, and trading the rights
  -- away must not launder that restriction.
  original_team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,

  player_id                 UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season_from               TEXT NOT NULL,

  status                    public.departure_decision_status NOT NULL DEFAULT 'pending',

  -- Snapshots taken when the departure is detected. players.market_value is
  -- overwritten by every Transfermarkt sync, so without these the figure a
  -- manager was quoted is unreconstructable days later — and the payout could
  -- silently differ from what the preview promised.
  market_value_at_departure NUMERIC(10,2),
  compensation_offered      NUMERIC(10,2),
  compensation_paid         NUMERIC(10,2),

  detected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When the manager must have chosen by. NULL during the offseason, where
  -- Kickoff is the deadline; set for mid-season departures, which cannot wait
  -- for an admin action that may be months away.
  decide_by                 TIMESTAMPTZ,
  decided_at                TIMESTAMPTZ,

  -- Return handling. returned_at is when the player reappeared in the PL;
  -- reinstate_by is the manager's window to make roster room for him.
  returned_at               TIMESTAMPTZ,
  reinstate_by              TIMESTAMPTZ,

  resolved_at               TIMESTAMPTZ,
  notes                     TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live decision per player per league. Terminal rows are excluded so the
-- same player can depart, return, and depart again across seasons — each
-- departure keeping its own snapshot and its own audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_departure_decision
  ON public.departure_decisions (league_id, player_id)
  WHERE status IN ('pending', 'retained', 'return_pending');

CREATE INDEX IF NOT EXISTS idx_departure_decisions_team_status
  ON public.departure_decisions (team_id, status);

CREATE INDEX IF NOT EXISTS idx_departure_decisions_league_status
  ON public.departure_decisions (league_id, status);

-- Rights lookup by player — used by the auction ownership filter, which must
-- not sweep a retained player onto the block out from under his rights holder.
CREATE INDEX IF NOT EXISTS idx_departure_decisions_player_open
  ON public.departure_decisions (player_id)
  WHERE status IN ('retained', 'return_pending');

COMMENT ON TABLE public.departure_decisions IS
  'One row per player departure from the Premier League per league. Records the manager''s retain-or-release choice, the snapshotted compensation offer, and the lifecycle of any retained rights. Also the per-event idempotency key for compensation payouts.';

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- Readable by every member of the league: retained rights are tradeable, so
-- they have to be discoverable on other managers' clubs (real clubs publish
-- their retained lists). All writes go through service-role code paths, which
-- enforce slot limits, ownership, and league state.
ALTER TABLE public.departure_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departure_decisions_select ON public.departure_decisions;
CREATE POLICY departure_decisions_select ON public.departure_decisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.league_id = departure_decisions.league_id
        AND t.user_id = auth.uid()
    )
  );
