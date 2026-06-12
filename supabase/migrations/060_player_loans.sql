-- ============================================================
-- Migration 060: Player Loans System
-- ============================================================

-- ── 1. New enum: loan_status ──────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_status') THEN
    CREATE TYPE public.loan_status AS ENUM (
      'pending',
      'active',
      'accepted_deferred',
      'recalled',
      'expired',
      'pending_activation',
      'rejected',
      'cancelled'
    );
  END IF;
END $$;

-- ── 2. Extend roster_status with loan_in and loan_out ────────
ALTER TYPE public.roster_status ADD VALUE IF NOT EXISTS 'loan_in';
ALTER TYPE public.roster_status ADD VALUE IF NOT EXISTS 'loan_out';

-- ── 3. Extend transaction_type ────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'loan_fee'
    AND enumtypid = 'public.transaction_type'::regtype)
  THEN ALTER TYPE public.transaction_type ADD VALUE 'loan_fee'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'loan_bonus'
    AND enumtypid = 'public.transaction_type'::regtype)
  THEN ALTER TYPE public.transaction_type ADD VALUE 'loan_bonus'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'loan_recall_penalty'
    AND enumtypid = 'public.transaction_type'::regtype)
  THEN ALTER TYPE public.transaction_type ADD VALUE 'loan_recall_penalty'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'loan_slot_buyback'
    AND enumtypid = 'public.transaction_type'::regtype)
  THEN ALTER TYPE public.transaction_type ADD VALUE 'loan_slot_buyback'; END IF;
END $$;

-- ── 4. League config columns ──────────────────────────────────

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS loan_slot_buyback_fee  INT NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS loan_bonus_cap_default INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_loan_outs          INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_loan_ins           INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS total_gameweeks        INT NOT NULL DEFAULT 38;

-- ── 5. player_loans table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_loans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id             UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  lender_team_id        UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  borrower_team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  -- Terms
  loan_fee              INT NOT NULL DEFAULT 0,
  start_gameweek        INT NOT NULL,
  end_gameweek          INT NOT NULL,

  -- Performance bonus
  bonus_rate            NUMERIC(6, 2) NOT NULL DEFAULT 0,
  bonus_cap             INT NOT NULL DEFAULT 0,
  bonus_points_scored   NUMERIC(8, 2) NOT NULL DEFAULT 0,
  bonus_settled         BOOLEAN NOT NULL DEFAULT FALSE,

  -- Recall
  has_recall            BOOLEAN NOT NULL DEFAULT FALSE,
  recall_activated      BOOLEAN NOT NULL DEFAULT FALSE,
  recall_penalty        INT,

  -- Slot buyback
  slot_buyback_used     BOOLEAN NOT NULL DEFAULT FALSE,
  slot_buyback_fee_paid INT,

  -- State
  status                public.loan_status NOT NULL DEFAULT 'pending',
  message               TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CHECK (lender_team_id <> borrower_team_id),
  CHECK (loan_fee >= 0),
  CHECK (bonus_rate >= 0),
  CHECK (bonus_cap >= 0),
  CHECK (end_gameweek > start_gameweek),
  CHECK (end_gameweek - start_gameweek >= 4),
  CHECK (end_gameweek - start_gameweek <= 16)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_player_loans_league
  ON public.player_loans(league_id);
CREATE INDEX IF NOT EXISTS idx_player_loans_lender
  ON public.player_loans(lender_team_id);
CREATE INDEX IF NOT EXISTS idx_player_loans_borrower
  ON public.player_loans(borrower_team_id);
CREATE INDEX IF NOT EXISTS idx_player_loans_player
  ON public.player_loans(player_id);
CREATE INDEX IF NOT EXISTS idx_player_loans_status
  ON public.player_loans(status);
CREATE INDEX IF NOT EXISTS idx_player_loans_end_gw
  ON public.player_loans(end_gameweek)
  WHERE status = 'active';

-- Updated_at trigger
CREATE OR REPLACE TRIGGER update_player_loans_updated_at
  BEFORE UPDATE ON public.player_loans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.player_loans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'player_loans' 
      AND policyname = 'Loans: read if league member'
  ) THEN
    CREATE POLICY "Loans: read if league member"
      ON public.player_loans FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.league_id = player_loans.league_id AND t.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Drop functions first to prevent parameter/return type conflicts
DROP FUNCTION IF EXISTS public.accumulate_loan_bonus_points(integer, text);
DROP FUNCTION IF EXISTS public.execute_loan_acceptance_rpc(uuid, uuid, uuid, uuid, integer, uuid);
DROP FUNCTION IF EXISTS public.execute_loan_recall_rpc(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.execute_loan_slot_buyback_rpc(uuid, uuid);
DROP FUNCTION IF EXISTS public.resolve_expired_loan_rpc(uuid, uuid, integer);

-- ── 6. RPC: accumulate_loan_bonus_points ─────────────────────

CREATE OR REPLACE FUNCTION public.accumulate_loan_bonus_points(
  p_gameweek INT,
  p_season   TEXT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INT;
BEGIN
  WITH points_by_player AS (
    SELECT player_id, SUM(fantasy_points) AS gw_points
    FROM public.player_stats
    WHERE gameweek = p_gameweek AND season = p_season
    GROUP BY player_id
  )
  UPDATE public.player_loans pl
  SET
    bonus_points_scored = bonus_points_scored + COALESCE(pbp.gw_points, 0),
    updated_at = NOW()
  FROM points_by_player pbp
  WHERE pl.player_id = pbp.player_id
    AND pl.status = 'active'
    AND pl.bonus_rate > 0
    AND pl.start_gameweek <= p_gameweek
    AND pl.end_gameweek > p_gameweek;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- ── 7. RPC: execute_loan_acceptance_rpc ─────────────────────

CREATE OR REPLACE FUNCTION public.execute_loan_acceptance_rpc(
  p_loan_id UUID,
  p_lender_team_id UUID,
  p_borrower_team_id UUID,
  p_player_id UUID,
  p_loan_fee INT,
  p_league_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lender_faab INT;
  v_borrower_faab INT;
  v_lender_active_loans_count INT;
  v_borrower_active_loans_count INT;
  v_max_loan_outs INT;
  v_max_loan_ins INT;
  v_player_status public.roster_status;
  v_roster_entry_id UUID;
BEGIN
  -- 1. Lock rows for update to prevent race conditions
  PERFORM 1 FROM public.teams WHERE id = p_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = p_borrower_team_id FOR UPDATE;
  PERFORM 1 FROM public.player_loans WHERE id = p_loan_id FOR UPDATE;

  -- Get max loan counts
  SELECT max_loan_outs, max_loan_ins
  INTO v_max_loan_outs, v_max_loan_ins
  FROM public.leagues
  WHERE id = p_league_id;

  -- 2. Double check loan is still pending
  IF NOT EXISTS (
    SELECT 1 FROM public.player_loans
    WHERE id = p_loan_id AND status = 'pending'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Loan is no longer pending');
  END IF;

  -- 3. Check borrower FAAB
  SELECT faab_budget INTO v_borrower_faab FROM public.teams WHERE id = p_borrower_team_id;
  IF v_borrower_faab < p_loan_fee THEN
    RETURN json_build_object('success', false, 'error', 'Borrower has insufficient Club Balance');
  END IF;

  -- 4. Check lender active loans count
  SELECT COUNT(1) INTO v_lender_active_loans_count
  FROM public.player_loans
  WHERE lender_team_id = p_lender_team_id AND status = 'active';

  IF v_lender_active_loans_count >= COALESCE(v_max_loan_outs, 1) THEN
    RETURN json_build_object('success', false, 'error', 'Lender has reached maximum active loan-outs limit');
  END IF;

  -- 5. Check borrower active loans count
  SELECT COUNT(1) INTO v_borrower_active_loans_count
  FROM public.player_loans
  WHERE borrower_team_id = p_borrower_team_id AND status = 'active';

  IF v_borrower_active_loans_count >= COALESCE(v_max_loan_ins, 2) THEN
    RETURN json_build_object('success', false, 'error', 'Borrower has reached maximum active loan-ins limit');
  END IF;

  -- 6. Verify player is still on lender roster and check status
  SELECT id, status INTO v_roster_entry_id, v_player_status
  FROM public.roster_entries
  WHERE team_id = p_lender_team_id AND player_id = p_player_id;

  IF v_roster_entry_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Player is no longer on lender roster');
  END IF;

  IF v_player_status IN ('ir', 'taxi', 'loan_in', 'loan_out') THEN
    RETURN json_build_object('success', false, 'error', 'Player status invalid for loan: ' || v_player_status);
  END IF;

  -- 7. Verify no other active/pending loan for this player
  IF EXISTS (
    SELECT 1 FROM public.player_loans
    WHERE player_id = p_player_id
      AND league_id = p_league_id
      AND status IN ('pending', 'active')
      AND id <> p_loan_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Player already involved in another active or pending loan');
  END IF;

  -- 8. Perform FAAB transfers
  IF p_loan_fee > 0 THEN
    -- Deduct from borrower
    UPDATE public.teams
    SET faab_budget = faab_budget - p_loan_fee, updated_at = NOW()
    WHERE id = p_borrower_team_id;

    -- Credit to lender
    UPDATE public.teams
    SET faab_budget = faab_budget + p_loan_fee, updated_at = NOW()
    WHERE id = p_lender_team_id;

    -- Log transaction for borrower
    INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
    VALUES (p_league_id, p_borrower_team_id, p_player_id, 'loan_fee', -p_loan_fee, 'Paid loan fee for player', NOW());

    -- Log transaction for lender
    INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
    VALUES (p_league_id, p_lender_team_id, p_player_id, 'loan_fee', p_loan_fee, 'Received loan fee for player', NOW());
  END IF;

  -- 9. Update lender roster entry status to 'loan_out'
  UPDATE public.roster_entries
  SET status = 'loan_out'
  WHERE id = v_roster_entry_id;

  -- 10. Insert borrower roster entry with status 'loan_in'
  INSERT INTO public.roster_entries (team_id, player_id, status, acquisition_type, acquisition_value, acquired_at)
  VALUES (p_borrower_team_id, p_player_id, 'loan_in', 'trade', p_loan_fee, NOW());

  -- 11. Update loan status to active
  UPDATE public.player_loans
  SET status = 'active', updated_at = NOW()
  WHERE id = p_loan_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ── 8. RPC: execute_loan_recall_rpc ─────────────────────

CREATE OR REPLACE FUNCTION public.execute_loan_recall_rpc(
  p_loan_id UUID,
  p_league_id UUID,
  p_roster_size INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lender_team_id UUID;
  v_borrower_team_id UUID;
  v_player_id UUID;
  v_loan_fee INT;
  v_has_recall BOOLEAN;
  v_status public.loan_status;
  v_recall_penalty INT;
  v_lender_faab INT;
  v_borrower_faab INT;
  v_active_count INT;
  
  -- Bonus variables
  v_bonus_rate NUMERIC;
  v_bonus_cap INT;
  v_bonus_points NUMERIC;
  v_raw_bonus INT;
  v_cap INT;
  v_capped_bonus INT;
  v_actual_bonus_pay INT;
  v_bonus_forgiven INT;
  
  -- Settings
  v_slot_buyback_fee INT;
BEGIN
  -- 1. Fetch loan details and lock
  SELECT lender_team_id, borrower_team_id, player_id, loan_fee, has_recall, status, bonus_rate, bonus_cap, bonus_points_scored
  INTO v_lender_team_id, v_borrower_team_id, v_player_id, v_loan_fee, v_has_recall, v_status, v_bonus_rate, v_bonus_cap, v_bonus_points
  FROM public.player_loans
  WHERE id = p_loan_id AND league_id = p_league_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Loan not found');
  END IF;

  IF v_status <> 'active' THEN
    RETURN json_build_object('success', false, 'error', 'Loan is not active');
  END IF;

  IF NOT v_has_recall THEN
    RETURN json_build_object('success', false, 'error', 'Recall clause is not included in this loan');
  END IF;

  -- 2. Lock teams
  PERFORM 1 FROM public.teams WHERE id = v_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = v_borrower_team_id FOR UPDATE;

  -- 3. Calculate recall penalty
  v_recall_penalty := 25;

  -- Check lender FAAB
  SELECT faab_budget INTO v_lender_faab FROM public.teams WHERE id = v_lender_team_id;
  IF v_lender_faab < v_recall_penalty THEN
    RETURN json_build_object('success', false, 'error', 'Lender has insufficient Club Balance for recall penalty');
  END IF;

  -- 4. Deduct recall penalty
  UPDATE public.teams
  SET faab_budget = faab_budget - v_recall_penalty, updated_at = NOW()
  WHERE id = v_lender_team_id;

  UPDATE public.teams
  SET faab_budget = faab_budget + v_recall_penalty, updated_at = NOW()
  WHERE id = v_borrower_team_id;

  -- Log recall penalty transactions
  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_recall_penalty', -v_recall_penalty, 'Paid recall penalty to borrower', NOW());

  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_borrower_team_id, v_player_id, 'loan_recall_penalty', v_recall_penalty, 'Received recall penalty from lender', NOW());

  -- 5. Settle performance bonus if applicable
  v_actual_bonus_pay := 0;
  v_bonus_forgiven := 0;
  IF v_bonus_rate > 0 THEN
    v_raw_bonus := FLOOR(v_bonus_points * v_bonus_rate);
    v_cap := CASE WHEN v_bonus_cap > 0 THEN v_bonus_cap ELSE v_loan_fee * 3 END;
    v_capped_bonus := LEAST(v_raw_bonus, v_cap);
    
    IF v_capped_bonus > 0 THEN
      -- Get updated borrower FAAB (includes the recall penalty credit now!)
      SELECT faab_budget INTO v_borrower_faab FROM public.teams WHERE id = v_borrower_team_id;
      v_actual_bonus_pay := LEAST(v_capped_bonus, v_borrower_faab);
      v_bonus_forgiven := v_capped_bonus - v_actual_bonus_pay;
      
      IF v_actual_bonus_pay > 0 THEN
        UPDATE public.teams
        SET faab_budget = faab_budget - v_actual_bonus_pay, updated_at = NOW()
        WHERE id = v_borrower_team_id;
        
        UPDATE public.teams
        SET faab_budget = faab_budget + v_actual_bonus_pay, updated_at = NOW()
        WHERE id = v_lender_team_id;
        
        INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
        VALUES (p_league_id, v_borrower_team_id, v_player_id, 'loan_bonus', -v_actual_bonus_pay, 'Paid performance bonus: ' || v_bonus_points || ' pts @ ' || v_bonus_rate || ' = ' || v_capped_bonus || ' (forgiven: ' || v_bonus_forgiven || ')', NOW());
        
        INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
        VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_bonus', v_actual_bonus_pay, 'Received performance bonus from borrower', NOW());
      END IF;
    END IF;
  END IF;

  -- 6. Delete borrower loan_in roster entry
  DELETE FROM public.roster_entries
  WHERE team_id = v_borrower_team_id AND player_id = v_player_id AND status = 'loan_in';

  -- 7. Count lender active roster
  SELECT COUNT(1) INTO v_active_count
  FROM public.roster_entries
  WHERE team_id = v_lender_team_id AND status NOT IN ('ir', 'taxi', 'loan_in');

  -- 8. Final state transitions
  IF v_active_count > p_roster_size THEN
    UPDATE public.player_loans
    SET 
      status = 'pending_activation',
      recall_activated = TRUE,
      recall_penalty = v_recall_penalty,
      bonus_settled = TRUE,
      updated_at = NOW()
    WHERE id = p_loan_id;
    
    RETURN json_build_object(
      'success', true, 
      'pending_activation', true, 
      'penalty', v_recall_penalty, 
      'bonus_paid', v_actual_bonus_pay, 
      'bonus_forgiven', v_bonus_forgiven
    );
  ELSE
    -- Revert lender player to bench
    UPDATE public.roster_entries
    SET status = 'bench'
    WHERE team_id = v_lender_team_id AND player_id = v_player_id AND status = 'loan_out';
    
    UPDATE public.player_loans
    SET 
      status = 'recalled',
      recall_activated = TRUE,
      recall_penalty = v_recall_penalty,
      bonus_settled = TRUE,
      updated_at = NOW()
    WHERE id = p_loan_id;
    
    RETURN json_build_object(
      'success', true, 
      'pending_activation', false, 
      'penalty', v_recall_penalty, 
      'bonus_paid', v_actual_bonus_pay, 
      'bonus_forgiven', v_bonus_forgiven
    );
  END IF;
END;
$$;

-- ── 9. RPC: execute_loan_slot_buyback_rpc ─────────────────────

CREATE OR REPLACE FUNCTION public.execute_loan_slot_buyback_rpc(
  p_loan_id UUID,
  p_league_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lender_team_id UUID;
  v_player_id UUID;
  v_status public.loan_status;
  v_slot_buyback_used BOOLEAN;
  v_lender_faab INT;
  v_slot_buyback_fee INT;
BEGIN
  -- 1. Lock loan and get details
  SELECT lender_team_id, player_id, status, slot_buyback_used
  INTO v_lender_team_id, v_player_id, v_status, v_slot_buyback_used
  FROM public.player_loans
  WHERE id = p_loan_id AND league_id = p_league_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Loan not found');
  END IF;

  IF v_status <> 'active' THEN
    RETURN json_build_object('success', false, 'error', 'Loan is not active');
  END IF;

  IF v_slot_buyback_used THEN
    RETURN json_build_object('success', false, 'error', 'Slot buyback has already been used for this loan');
  END IF;

  -- 2. Lock team
  PERFORM 1 FROM public.teams WHERE id = v_lender_team_id FOR UPDATE;

  -- 3. Get buyback fee from leagues
  SELECT loan_slot_buyback_fee INTO v_slot_buyback_fee FROM public.leagues WHERE id = p_league_id;
  v_slot_buyback_fee := COALESCE(v_slot_buyback_fee, 25);

  -- Check lender FAAB
  SELECT faab_budget INTO v_lender_faab FROM public.teams WHERE id = v_lender_team_id;
  IF v_lender_faab < v_slot_buyback_fee THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient Club Balance for slot buyback. Required: €' || v_slot_buyback_fee || 'm');
  END IF;

  -- 4. Deduct and burn fee
  UPDATE public.teams
  SET faab_budget = faab_budget - v_slot_buyback_fee, updated_at = NOW()
  WHERE id = v_lender_team_id;

  -- Log transaction (burned)
  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_slot_buyback', -v_slot_buyback_fee, 'Paid slot buyback fee (burned)', NOW());

  -- 5. Update loan
  UPDATE public.player_loans
  SET 
    slot_buyback_used = TRUE,
    slot_buyback_fee_paid = v_slot_buyback_fee,
    updated_at = NOW()
  WHERE id = p_loan_id;

  RETURN json_build_object('success', true, 'fee_paid', v_slot_buyback_fee);
END;
$$;

-- ── 10. RPC: resolve_expired_loan_rpc ─────────────────────

CREATE OR REPLACE FUNCTION public.resolve_expired_loan_rpc(
  p_loan_id UUID,
  p_league_id UUID,
  p_roster_size INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lender_team_id UUID;
  v_borrower_team_id UUID;
  v_player_id UUID;
  v_loan_fee INT;
  v_status public.loan_status;
  v_borrower_faab INT;
  v_active_count INT;
  
  -- Bonus variables
  v_bonus_rate NUMERIC;
  v_bonus_cap INT;
  v_bonus_points NUMERIC;
  v_raw_bonus INT;
  v_cap INT;
  v_capped_bonus INT;
  v_actual_bonus_pay INT;
  v_bonus_forgiven INT;
BEGIN
  -- 1. Fetch loan details and lock
  SELECT lender_team_id, borrower_team_id, player_id, loan_fee, status, bonus_rate, bonus_cap, bonus_points_scored
  INTO v_lender_team_id, v_borrower_team_id, v_player_id, v_loan_fee, v_status, v_bonus_rate, v_bonus_cap, v_bonus_points
  FROM public.player_loans
  WHERE id = p_loan_id AND league_id = p_league_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Loan not found');
  END IF;

  IF v_status <> 'active' THEN
    RETURN json_build_object('success', false, 'error', 'Loan is not active');
  END IF;

  -- 2. Lock teams
  PERFORM 1 FROM public.teams WHERE id = v_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = v_borrower_team_id FOR UPDATE;

  -- 3. Settle performance bonus if applicable
  v_actual_bonus_pay := 0;
  v_bonus_forgiven := 0;
  IF v_bonus_rate > 0 THEN
    v_raw_bonus := FLOOR(v_bonus_points * v_bonus_rate);
    v_cap := CASE WHEN v_bonus_cap > 0 THEN v_bonus_cap ELSE v_loan_fee * 3 END;
    v_capped_bonus := LEAST(v_raw_bonus, v_cap);
    
    IF v_capped_bonus > 0 THEN
      SELECT faab_budget INTO v_borrower_faab FROM public.teams WHERE id = v_borrower_team_id;
      v_actual_bonus_pay := LEAST(v_capped_bonus, v_borrower_faab);
      v_bonus_forgiven := v_capped_bonus - v_actual_bonus_pay;
      
      IF v_actual_bonus_pay > 0 THEN
        UPDATE public.teams
        SET faab_budget = faab_budget - v_actual_bonus_pay, updated_at = NOW()
        WHERE id = v_borrower_team_id;
        
        UPDATE public.teams
        SET faab_budget = faab_budget + v_actual_bonus_pay, updated_at = NOW()
        WHERE id = v_lender_team_id;
        
        INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
        VALUES (p_league_id, v_borrower_team_id, v_player_id, 'loan_bonus', -v_actual_bonus_pay, 'Paid performance bonus: ' || v_bonus_points || ' pts @ ' || v_bonus_rate || ' = ' || v_capped_bonus || ' (forgiven: ' || v_bonus_forgiven || ')', NOW());
        
        INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
        VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_bonus', v_actual_bonus_pay, 'Received performance bonus from borrower', NOW());
      END IF;
    END IF;
  END IF;

  -- 4. Delete borrower loan_in roster entry
  DELETE FROM public.roster_entries
  WHERE team_id = v_borrower_team_id AND player_id = v_player_id AND status = 'loan_in';

  -- 5. Count lender active roster
  SELECT COUNT(1) INTO v_active_count
  FROM public.roster_entries
  WHERE team_id = v_lender_team_id AND status NOT IN ('ir', 'taxi', 'loan_in');

  -- 6. Final state transitions
  IF v_active_count > p_roster_size THEN
    UPDATE public.player_loans
    SET 
      status = 'pending_activation',
      bonus_settled = TRUE,
      updated_at = NOW()
    WHERE id = p_loan_id;
    
    RETURN json_build_object(
      'success', true, 
      'pending_activation', true, 
      'bonus_paid', v_actual_bonus_pay, 
      'bonus_forgiven', v_bonus_forgiven
    );
  ELSE
    -- Revert lender player to bench
    UPDATE public.roster_entries
    SET status = 'bench'
    WHERE team_id = v_lender_team_id AND player_id = v_player_id AND status = 'loan_out';
    
    UPDATE public.player_loans
    SET 
      status = 'expired',
      bonus_settled = TRUE,
      updated_at = NOW()
    WHERE id = p_loan_id;
    
    RETURN json_build_object(
      'success', true, 
      'pending_activation', false, 
      'bonus_paid', v_actual_bonus_pay, 
      'bonus_forgiven', v_bonus_forgiven
    );
  END IF;
END;
$$;

-- Revoke execute permissions
REVOKE EXECUTE ON FUNCTION public.accumulate_loan_bonus_points(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_loan_acceptance_rpc(uuid, uuid, uuid, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_loan_recall_rpc(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_loan_slot_buyback_rpc(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_expired_loan_rpc(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
