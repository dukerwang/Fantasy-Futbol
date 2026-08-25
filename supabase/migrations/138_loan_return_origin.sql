-- Remember where a loanee sat when the loan started, and put him back there.
--
-- First XI (`active`) and the four matchday bench slots share the active roster
-- with Reserves; the lineup JSON is what distinguishes those three, and we do
-- not write a returning player into this week's XI or a bench slot. Both land
-- as Reserves (`bench` status, unassigned). Academy (`taxi`) is a real stash —
-- restore it when the player is still U21 and a slot is free. Otherwise fall
-- through to Reserves, or pending_activation if the active roster is full.

ALTER TABLE public.player_loans
  ADD COLUMN IF NOT EXISTS origin_status public.roster_status;

COMMENT ON COLUMN public.player_loans.origin_status IS
  'Roster status at loan start. taxi restores to academy; active/bench restore to Reserves.';

-- Pending / deferred loans still sit on the lender in their original status.
UPDATE public.player_loans pl
SET origin_status = re.status
FROM public.roster_entries re
WHERE re.team_id = pl.lender_team_id
  AND re.player_id = pl.player_id
  AND re.status IN ('active', 'bench', 'taxi')
  AND pl.status IN ('pending', 'accepted_deferred')
  AND pl.origin_status IS NULL;

CREATE OR REPLACE FUNCTION public.place_returning_loanee(
  p_lender_team_id UUID,
  p_player_id UUID,
  p_league_id UUID,
  p_origin_status public.roster_status,
  p_roster_size INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_taxi_size INT;
  v_taxi_age_limit INT;
  v_dob DATE;
  v_age NUMERIC;
  v_taxi_count INT;
  v_active_count INT;
BEGIN
  IF p_origin_status = 'taxi' THEN
    SELECT taxi_size, taxi_age_limit
    INTO v_taxi_size, v_taxi_age_limit
    FROM public.leagues
    WHERE id = p_league_id;

    SELECT date_of_birth INTO v_dob
    FROM public.players
    WHERE id = p_player_id;

    SELECT COUNT(1) INTO v_taxi_count
    FROM public.roster_entries
    WHERE team_id = p_lender_team_id AND status = 'taxi';

    IF v_dob IS NOT NULL THEN
      v_age := DATE_PART('year', AGE(v_dob));
    END IF;

    IF v_taxi_count < COALESCE(v_taxi_size, 3)
       AND v_age IS NOT NULL
       AND v_age <= COALESCE(v_taxi_age_limit, 21) THEN
      UPDATE public.roster_entries
      SET status = 'taxi'
      WHERE team_id = p_lender_team_id
        AND player_id = p_player_id
        AND status = 'loan_out';

      RETURN jsonb_build_object('pending', false, 'status', 'taxi');
    END IF;
  END IF;

  SELECT COUNT(1) INTO v_active_count
  FROM public.roster_entries
  WHERE team_id = p_lender_team_id AND status NOT IN ('ir', 'taxi', 'loan_in');

  IF v_active_count > p_roster_size THEN
    RETURN jsonb_build_object('pending', true, 'status', 'loan_out');
  END IF;

  UPDATE public.roster_entries
  SET status = 'bench'
  WHERE team_id = p_lender_team_id
    AND player_id = p_player_id
    AND status = 'loan_out';

  RETURN jsonb_build_object('pending', false, 'status', 'bench');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_returning_loanee(uuid, uuid, uuid, public.roster_status, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_returning_loanee(uuid, uuid, uuid, public.roster_status, integer)
  TO service_role;

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
  PERFORM 1 FROM public.teams WHERE id = p_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = p_borrower_team_id FOR UPDATE;
  PERFORM 1 FROM public.player_loans WHERE id = p_loan_id FOR UPDATE;

  SELECT max_loan_outs, max_loan_ins
  INTO v_max_loan_outs, v_max_loan_ins
  FROM public.leagues
  WHERE id = p_league_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_loans
    WHERE id = p_loan_id AND status IN ('pending', 'accepted_deferred')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Loan is no longer pending');
  END IF;

  SELECT faab_budget INTO v_borrower_faab FROM public.teams WHERE id = p_borrower_team_id;
  IF v_borrower_faab < p_loan_fee THEN
    RETURN json_build_object('success', false, 'error', 'Borrower has insufficient Club Balance');
  END IF;

  SELECT COUNT(1) INTO v_lender_active_loans_count
  FROM public.player_loans
  WHERE lender_team_id = p_lender_team_id AND status = 'active';

  IF v_lender_active_loans_count >= COALESCE(v_max_loan_outs, 1) THEN
    RETURN json_build_object('success', false, 'error', 'Lender has reached maximum active loan-outs limit');
  END IF;

  SELECT COUNT(1) INTO v_borrower_active_loans_count
  FROM public.player_loans
  WHERE borrower_team_id = p_borrower_team_id AND status = 'active';

  IF v_borrower_active_loans_count >= COALESCE(v_max_loan_ins, 2) THEN
    RETURN json_build_object('success', false, 'error', 'Borrower has reached maximum active loan-ins limit');
  END IF;

  SELECT id, status INTO v_roster_entry_id, v_player_status
  FROM public.roster_entries
  WHERE team_id = p_lender_team_id AND player_id = p_player_id;

  IF v_roster_entry_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Player is no longer on lender roster');
  END IF;

  IF v_player_status IN ('ir', 'loan_in', 'loan_out') THEN
    RETURN json_build_object('success', false, 'error', 'Player status invalid for loan: ' || v_player_status);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.player_loans
    WHERE player_id = p_player_id
      AND league_id = p_league_id
      AND status IN ('pending', 'active')
      AND id <> p_loan_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Player already involved in another active or pending loan');
  END IF;

  IF p_loan_fee > 0 THEN
    UPDATE public.teams
    SET faab_budget = faab_budget - p_loan_fee, updated_at = NOW()
    WHERE id = p_borrower_team_id;

    UPDATE public.teams
    SET faab_budget = faab_budget + p_loan_fee, updated_at = NOW()
    WHERE id = p_lender_team_id;

    INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
    VALUES (p_league_id, p_borrower_team_id, p_player_id, 'loan_fee', -p_loan_fee, 'Paid loan fee for player', NOW());

    INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
    VALUES (p_league_id, p_lender_team_id, p_player_id, 'loan_fee', p_loan_fee, 'Received loan fee for player', NOW());
  END IF;

  UPDATE public.roster_entries
  SET status = 'loan_out'
  WHERE id = v_roster_entry_id;

  INSERT INTO public.roster_entries (team_id, player_id, status, acquisition_type, acquisition_value, acquired_at)
  VALUES (p_borrower_team_id, p_player_id, 'loan_in', 'trade', p_loan_fee, NOW());

  UPDATE public.player_loans
  SET status = 'active',
      origin_status = v_player_status,
      updated_at = NOW()
  WHERE id = p_loan_id;

  RETURN json_build_object('success', true);
END;
$$;

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
  v_origin_status public.roster_status;
  v_borrower_faab INT;
  v_bonus_rate NUMERIC;
  v_bonus_cap INT;
  v_bonus_points NUMERIC;
  v_raw_bonus INT;
  v_cap INT;
  v_capped_bonus INT;
  v_actual_bonus_pay INT;
  v_bonus_forgiven INT;
  v_place JSONB;
BEGIN
  SELECT lender_team_id, borrower_team_id, player_id, loan_fee, status,
         bonus_rate, bonus_cap, bonus_points_scored, origin_status
  INTO v_lender_team_id, v_borrower_team_id, v_player_id, v_loan_fee, v_status,
       v_bonus_rate, v_bonus_cap, v_bonus_points, v_origin_status
  FROM public.player_loans
  WHERE id = p_loan_id AND league_id = p_league_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Loan not found');
  END IF;

  IF v_status <> 'active' THEN
    RETURN json_build_object('success', false, 'error', 'Loan is not active');
  END IF;

  PERFORM 1 FROM public.teams WHERE id = v_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = v_borrower_team_id FOR UPDATE;

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

  DELETE FROM public.roster_entries
  WHERE team_id = v_borrower_team_id AND player_id = v_player_id AND status = 'loan_in';

  v_place := public.place_returning_loanee(
    v_lender_team_id, v_player_id, p_league_id, v_origin_status, p_roster_size
  );

  IF (v_place->>'pending')::boolean THEN
    UPDATE public.player_loans
    SET status = 'pending_activation', bonus_settled = TRUE, updated_at = NOW()
    WHERE id = p_loan_id;

    RETURN json_build_object(
      'success', true,
      'pending_activation', true,
      'returned_to', v_place->>'status',
      'bonus_paid', v_actual_bonus_pay,
      'bonus_forgiven', v_bonus_forgiven
    );
  END IF;

  UPDATE public.player_loans
  SET status = 'expired', bonus_settled = TRUE, updated_at = NOW()
  WHERE id = p_loan_id;

  RETURN json_build_object(
    'success', true,
    'pending_activation', false,
    'returned_to', v_place->>'status',
    'bonus_paid', v_actual_bonus_pay,
    'bonus_forgiven', v_bonus_forgiven
  );
END;
$$;

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
  v_origin_status public.roster_status;
  v_recall_penalty INT;
  v_lender_faab INT;
  v_borrower_faab INT;
  v_bonus_rate NUMERIC;
  v_bonus_cap INT;
  v_bonus_points NUMERIC;
  v_raw_bonus INT;
  v_cap INT;
  v_capped_bonus INT;
  v_actual_bonus_pay INT;
  v_bonus_forgiven INT;
  v_place JSONB;
BEGIN
  SELECT lender_team_id, borrower_team_id, player_id, loan_fee, has_recall, status,
         bonus_rate, bonus_cap, bonus_points_scored, origin_status
  INTO v_lender_team_id, v_borrower_team_id, v_player_id, v_loan_fee, v_has_recall, v_status,
       v_bonus_rate, v_bonus_cap, v_bonus_points, v_origin_status
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

  PERFORM 1 FROM public.teams WHERE id = v_lender_team_id FOR UPDATE;
  PERFORM 1 FROM public.teams WHERE id = v_borrower_team_id FOR UPDATE;

  v_recall_penalty := 25;

  SELECT faab_budget INTO v_lender_faab FROM public.teams WHERE id = v_lender_team_id;
  IF v_lender_faab < v_recall_penalty THEN
    RETURN json_build_object('success', false, 'error', 'Lender has insufficient Club Balance for recall penalty');
  END IF;

  UPDATE public.teams
  SET faab_budget = faab_budget - v_recall_penalty, updated_at = NOW()
  WHERE id = v_lender_team_id;

  UPDATE public.teams
  SET faab_budget = faab_budget + v_recall_penalty, updated_at = NOW()
  WHERE id = v_borrower_team_id;

  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_recall_penalty', -v_recall_penalty, 'Paid recall penalty to borrower', NOW());

  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_borrower_team_id, v_player_id, 'loan_recall_penalty', v_recall_penalty, 'Received recall penalty from lender', NOW());

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

  DELETE FROM public.roster_entries
  WHERE team_id = v_borrower_team_id AND player_id = v_player_id AND status = 'loan_in';

  v_place := public.place_returning_loanee(
    v_lender_team_id, v_player_id, p_league_id, v_origin_status, p_roster_size
  );

  IF (v_place->>'pending')::boolean THEN
    UPDATE public.player_loans
    SET status = 'pending_activation',
        recall_activated = TRUE,
        recall_penalty = v_recall_penalty,
        bonus_settled = TRUE,
        updated_at = NOW()
    WHERE id = p_loan_id;

    RETURN json_build_object(
      'success', true,
      'pending_activation', true,
      'returned_to', v_place->>'status',
      'penalty', v_recall_penalty,
      'bonus_paid', v_actual_bonus_pay,
      'bonus_forgiven', v_bonus_forgiven
    );
  END IF;

  UPDATE public.player_loans
  SET status = 'recalled',
      recall_activated = TRUE,
      recall_penalty = v_recall_penalty,
      bonus_settled = TRUE,
      updated_at = NOW()
  WHERE id = p_loan_id;

  RETURN json_build_object(
    'success', true,
    'pending_activation', false,
    'returned_to', v_place->>'status',
    'penalty', v_recall_penalty,
    'bonus_paid', v_actual_bonus_pay,
    'bonus_forgiven', v_bonus_forgiven
  );
END;
$$;
