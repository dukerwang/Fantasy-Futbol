-- ============================================================
-- Migration 094: Solidarity on drop severance and slot buyback
-- ============================================================
-- Two more amounts were being destroyed outright: the 20% drop severance fee
-- (charged on plain drops via executeDrop.ts) and the loan slot buyback fee,
-- which migration 060 comments as "Deduct and burn fee".
--
-- Both now recirculate on the same terms as an auction bid, minus the Scout's
-- Fee — nobody opened an auction, so there is no scout, and the whole pool
-- splits equally among the other clubs.
--
-- Reference implementation: src/lib/economy/solidarity.ts, hasScout = false.

CREATE OR REPLACE FUNCTION public.distribute_solidarity(
  p_league_id     UUID,
  p_payer_team_id UUID,
  p_amount        INT,
  p_reason        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share NUMERIC := 0.20;
  v_pool INT := 0;
  v_club_count INT := 0;
  v_per_club INT := 0;
  s RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'pool', 0, 'per_club', 0, 'club_count', 0);
  END IF;

  SELECT COALESCE(solidarity_share, 0.20) INTO v_share
  FROM public.leagues WHERE id = p_league_id;
  v_share := COALESCE(v_share, 0.20);

  -- faab_budget is INT: floor at every step, remainder burns.
  v_pool := FLOOR(p_amount * v_share);

  SELECT COUNT(1) INTO v_club_count
  FROM public.teams
  WHERE league_id = p_league_id AND id <> p_payer_team_id;

  IF v_club_count > 0 THEN
    v_per_club := FLOOR(v_pool / v_club_count);
  END IF;

  IF v_per_club > 0 THEN
    FOR s IN
      SELECT id FROM public.teams
      WHERE league_id = p_league_id AND id <> p_payer_team_id
    LOOP
      UPDATE public.teams
      SET faab_budget = faab_budget + v_per_club,
          updated_at = NOW()
      WHERE id = s.id;

      INSERT INTO public.transactions (
        league_id, team_id, type, faab_bid, notes, processed_at, created_at
      ) VALUES (
        p_league_id, s.id, 'solidarity_payment', v_per_club, p_reason, NOW(), NOW()
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'pool', v_pool, 'per_club', v_per_club, 'club_count', v_club_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.distribute_solidarity(uuid, uuid, int, text)
  FROM PUBLIC, anon, authenticated;


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

  -- 4. Deduct fee, recirculate a share (migration 094)
  UPDATE public.teams
  SET faab_budget = faab_budget - v_slot_buyback_fee, updated_at = NOW()
  WHERE id = v_lender_team_id;

  -- Log transaction (burned)
  INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
  VALUES (p_league_id, v_lender_team_id, v_player_id, 'loan_slot_buyback', -v_slot_buyback_fee, 'Paid slot buyback fee', NOW());

  PERFORM public.distribute_solidarity(
    p_league_id, v_lender_team_id, v_slot_buyback_fee,
    'Solidarity payment from a loan slot buyback fee'
  );

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

REVOKE EXECUTE ON FUNCTION public.execute_loan_slot_buyback_rpc(uuid, uuid) FROM PUBLIC, anon, authenticated;
