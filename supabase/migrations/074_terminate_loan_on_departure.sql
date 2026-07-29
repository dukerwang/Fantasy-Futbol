-- Gaffa — Migration 074: end a loan when the player leaves the Premier League
--
-- A loaned player has TWO roster entries: `loan_out` on the lender and
-- `loan_in` on the borrower (roster_entries is unique on (player_id, team_id),
-- not on player alone). When that player leaves the PL, the departure decision
-- only ever touches the owner's entry — so without this the borrower keeps a
-- `loan_in` row for a player who no longer exists in the competition, occupying
-- nothing useful and scoring nothing, forever.
--
-- Terms on termination, and why:
--   * Performance bonuses settle on points actually scored, exactly as they do
--     at natural expiry. The borrower had the player for that long and owes for
--     what he produced.
--   * The loan fee is NOT refunded. The borrower bought a risk and the risk
--     landed — the same answer real football gives when a loanee gets injured,
--     and the same answer `resolve_expired_loan_rpc` already gives.
--   * No recall penalty. Nobody recalled anyone; the competition removed him.
--
-- Unlike natural expiry there is no `pending_activation` branch. That state
-- exists to park a returning player when the lender is over capacity, but this
-- player is not returning to anyone's squad — the departure decision is about
-- to remove him from the roster entirely. Reverting to 'bench' hands the
-- decision flow an ordinary owned entry to act on.

CREATE OR REPLACE FUNCTION public.terminate_loan_on_departure_rpc(
  p_league_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_loan             RECORD;
  v_raw_bonus        NUMERIC;
  v_cap              INT;
  v_capped_bonus     INT;
  v_borrower_faab    INT;
  v_actual_bonus_pay INT := 0;
  v_bonus_forgiven   INT := 0;
  v_results          JSONB := '[]'::JSONB;
BEGIN
  FOR v_loan IN
    SELECT *
    FROM public.player_loans
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND status IN ('active', 'accepted_deferred', 'pending_activation')
    FOR UPDATE
  LOOP
    PERFORM 1 FROM public.teams WHERE id = v_loan.lender_team_id FOR UPDATE;
    PERFORM 1 FROM public.teams WHERE id = v_loan.borrower_team_id FOR UPDATE;

    v_actual_bonus_pay := 0;
    v_bonus_forgiven := 0;

    -- Settle accrued performance bonus, unless a previous transition already did.
    IF v_loan.bonus_rate > 0 AND NOT v_loan.bonus_settled THEN
      v_raw_bonus := FLOOR(v_loan.bonus_points_scored * v_loan.bonus_rate);
      v_cap := CASE WHEN v_loan.bonus_cap > 0 THEN v_loan.bonus_cap ELSE v_loan.loan_fee * 3 END;
      v_capped_bonus := LEAST(v_raw_bonus, v_cap);

      IF v_capped_bonus > 0 THEN
        SELECT faab_budget INTO v_borrower_faab FROM public.teams WHERE id = v_loan.borrower_team_id;
        v_actual_bonus_pay := LEAST(v_capped_bonus, v_borrower_faab);
        v_bonus_forgiven := v_capped_bonus - v_actual_bonus_pay;

        IF v_actual_bonus_pay > 0 THEN
          UPDATE public.teams
          SET faab_budget = faab_budget - v_actual_bonus_pay, updated_at = NOW()
          WHERE id = v_loan.borrower_team_id;

          UPDATE public.teams
          SET faab_budget = faab_budget + v_actual_bonus_pay, updated_at = NOW()
          WHERE id = v_loan.lender_team_id;

          INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
          VALUES (p_league_id, v_loan.borrower_team_id, p_player_id, 'loan_bonus', -v_actual_bonus_pay,
                  'Paid performance bonus on loan ended early — player left the Premier League ('
                    || v_loan.bonus_points_scored || ' pts @ ' || v_loan.bonus_rate
                    || ', forgiven: ' || v_bonus_forgiven || ')', NOW());

          INSERT INTO public.transactions (league_id, team_id, player_id, type, faab_bid, notes, created_at)
          VALUES (p_league_id, v_loan.lender_team_id, p_player_id, 'loan_bonus', v_actual_bonus_pay,
                  'Received performance bonus — loan ended early, player left the Premier League', NOW());
        END IF;
      END IF;
    END IF;

    -- The borrower's squad place is freed immediately: there is nothing left to
    -- borrow, and holding the row would block a legitimate signing.
    DELETE FROM public.roster_entries
    WHERE team_id = v_loan.borrower_team_id
      AND player_id = p_player_id
      AND status = 'loan_in';

    -- Hand the owner an ordinary entry for the departure decision to resolve.
    UPDATE public.roster_entries
    SET status = 'bench'
    WHERE team_id = v_loan.lender_team_id
      AND player_id = p_player_id
      AND status = 'loan_out';

    UPDATE public.player_loans
    SET status = 'expired',
        bonus_settled = TRUE,
        message = COALESCE(message || ' | ', '') || 'Ended early: player left the Premier League.',
        updated_at = NOW()
    WHERE id = v_loan.id;

    v_results := v_results || jsonb_build_object(
      'loan_id', v_loan.id,
      'lender_team_id', v_loan.lender_team_id,
      'borrower_team_id', v_loan.borrower_team_id,
      'bonus_paid', v_actual_bonus_pay,
      'bonus_forgiven', v_bonus_forgiven
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'terminated', v_results);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.terminate_loan_on_departure_rpc(uuid, uuid) FROM PUBLIC, anon, authenticated;
