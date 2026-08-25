-- Academy (taxi) players may be loaned. IR and players already on a loan
-- stay blocked. Acceptance still flips the lender row to loan_out (which
-- frees the academy slot) and inserts loan_in on the borrower; expiry
-- returns the player to the lender's bench, same as any other loan.

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

  -- 2. Double check loan is still pending OR was deferred past a kickoff lock.
  -- Accept both 'pending' (immediate) and 'accepted_deferred' (post-GW).
  IF NOT EXISTS (
    SELECT 1 FROM public.player_loans
    WHERE id = p_loan_id AND status IN ('pending', 'accepted_deferred')
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

  IF v_player_status IN ('ir', 'loan_in', 'loan_out') THEN
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
