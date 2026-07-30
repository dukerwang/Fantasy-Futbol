-- ============================================================
-- Migration 092: Monthly merit payments
-- ============================================================
-- Pays the regular-season pool during the season on match results, in ten
-- instalments (GW4/8/.../36, plus GW37-38), instead of as a lump sum at the
-- offseason reset.
--
-- Idempotency is enforced by the DATABASE, not by caller discipline.
-- prizeDistribution.ts documents itself as "idempotent in spirit but NOT
-- strictly protected from double-pays" because it keys on a matched notes
-- string; a merit payment fires from gameweek resolution, which can legitimately
-- re-run, so it needs a real unique constraint.

-- ── 1. Extend transaction_type ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'merit_payment'
      AND enumtypid = 'public.transaction_type'::regtype
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'merit_payment';
  END IF;
END $$;

-- ── 2. The ledger of what has been paid ─────────────────────
CREATE TABLE IF NOT EXISTS public.merit_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season       TEXT NOT NULL,
  period_index INT  NOT NULL CHECK (period_index BETWEEN 1 AND 10),
  amount       INT  NOT NULL,
  wins         INT  NOT NULL DEFAULT 0,
  draws        INT  NOT NULL DEFAULT 0,
  losses       INT  NOT NULL DEFAULT 0,
  byes         INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The whole point of this table: one payment per club per period per season.
  CONSTRAINT merit_payments_unique_period
    UNIQUE (league_id, team_id, season, period_index)
);

CREATE INDEX IF NOT EXISTS idx_merit_payments_league_season
  ON public.merit_payments(league_id, season);

ALTER TABLE public.merit_payments ENABLE ROW LEVEL SECURITY;

-- Managers may read their own league's merit history; only the service role
-- (used by cron/admin paths) writes, via the RPC below.
DROP POLICY IF EXISTS merit_payments_select_own_league ON public.merit_payments;
CREATE POLICY merit_payments_select_own_league ON public.merit_payments
  FOR SELECT USING (
    league_id IN (
      SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
    )
  );

-- ── 3. The credit RPC ───────────────────────────────────────
-- Atomic: the merit_payments row, the balance update and the transactions row
-- all commit together, so a crash cannot leave a paid balance with no record
-- (or a record with no payment).
CREATE OR REPLACE FUNCTION public.credit_merit_payment(
  p_league_id    UUID,
  p_team_id      UUID,
  p_season       TEXT,
  p_period_index INT,
  p_amount       INT,
  p_notes        TEXT,
  p_wins         INT DEFAULT 0,
  p_draws        INT DEFAULT 0,
  p_losses       INT DEFAULT 0,
  p_byes         INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'credited', false,
                              'error', 'Merit payment cannot be negative');
  END IF;

  -- Claim the period first. ON CONFLICT DO NOTHING makes a re-run a no-op
  -- rather than a double-pay, and reports which happened.
  INSERT INTO public.merit_payments (
    league_id, team_id, season, period_index, amount, wins, draws, losses, byes
  ) VALUES (
    p_league_id, p_team_id, p_season, p_period_index, p_amount,
    p_wins, p_draws, p_losses, p_byes
  )
  ON CONFLICT (league_id, team_id, season, period_index) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'credited', false,
                              'error', 'Period already paid');
  END IF;

  -- A zero payment is legal (a winless short period can still be zero if a
  -- league configures loss = 0), and the claim row above still records it.
  IF p_amount > 0 THEN
    UPDATE public.teams
    SET faab_budget = faab_budget + p_amount,
        updated_at  = NOW()
    WHERE id = p_team_id;

    INSERT INTO public.transactions (
      league_id, team_id, type, faab_bid, notes, processed_at, created_at
    ) VALUES (
      p_league_id, p_team_id, 'merit_payment', p_amount, p_notes, NOW(), NOW()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'credited', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_merit_payment(uuid, uuid, text, int, int, text, int, int, int, int)
  FROM PUBLIC, anon, authenticated;
