-- ============================================================
-- Migration 058: Fix execute_trade_transaction_rpc to accept
--                accepted_deferred trades from matchupProcessor
-- ============================================================
--
-- Bug: The RPC blocked on status <> 'pending', but trades deferred
-- during a live GW have status 'accepted_deferred'. At gameweek end,
-- matchupProcessor calls this RPC on those trades and they were all
-- being rejected. This patch widens the guard to also accept the
-- accepted_deferred status so deferred trades execute correctly.

CREATE OR REPLACE FUNCTION public.execute_trade_transaction_rpc(
  p_trade_id UUID,
  p_roster_size INT,
  p_min_roster_size INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade RECORD;
  v_team_a RECORD;
  v_team_b RECORD;
  v_team_a_match_count INT;
  v_team_b_match_count INT;
  v_team_a_current_size INT;
  v_team_b_current_size INT;
  v_team_a_after INT;
  v_team_b_after INT;
  v_player_id UUID;
  v_team_a_new_faab INT;
  v_team_b_new_faab INT;
  v_now TIMESTAMPTZ := NOW();
  v_result JSONB;
BEGIN
  -- 1. Fetch and lock trade proposal
  SELECT *
  INTO v_trade
  FROM public.trade_proposals
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade proposal not found');
  END IF;

  -- Accept both 'pending' (immediate) and 'accepted_deferred' (post-GW) status
  IF v_trade.status NOT IN ('pending', 'accepted_deferred') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is already ' || v_trade.status);
  END IF;

  -- 2. Lock teams
  SELECT id, faab_budget, team_name, user_id
  INTO v_team_a
  FROM public.teams
  WHERE id = v_trade.team_a_id
  FOR UPDATE;

  SELECT id, faab_budget, team_name, user_id
  INTO v_team_b
  FROM public.teams
  WHERE id = v_trade.team_b_id
  FOR UPDATE;

  IF v_team_a.id IS NULL OR v_team_b.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'One or both teams not found');
  END IF;

  -- 3. Verify offered players are still on Team A
  IF v_trade.offered_players IS NOT NULL AND cardinality(v_trade.offered_players) > 0 THEN
    SELECT count(1)
    INTO v_team_a_match_count
    FROM public.roster_entries
    WHERE team_id = v_trade.team_a_id
      AND player_id = ANY(v_trade.offered_players);

    IF v_team_a_match_count <> cardinality(v_trade.offered_players) THEN
      RETURN jsonb_build_object('success', false, 'error', 'One or more offered players are no longer on the proposing team''s roster. The trade cannot be completed.');
    END IF;
  END IF;

  -- 4. Verify requested players are still on Team B
  IF v_trade.requested_players IS NOT NULL AND cardinality(v_trade.requested_players) > 0 THEN
    SELECT count(1)
    INTO v_team_b_match_count
    FROM public.roster_entries
    WHERE team_id = v_trade.team_b_id
      AND player_id = ANY(v_trade.requested_players);

    IF v_team_b_match_count <> cardinality(v_trade.requested_players) THEN
      RETURN jsonb_build_object('success', false, 'error', 'One or more requested players are no longer on your roster. The trade cannot be completed.');
    END IF;
  END IF;

  -- 5. Validate FAAB budgets
  IF v_trade.offered_faab > v_team_a.faab_budget THEN
    RETURN jsonb_build_object('success', false, 'error', 'The proposing team only has €' || v_team_a.faab_budget || 'm FAAB but offered €' || v_trade.offered_faab || 'm. The trade cannot be completed.');
  END IF;

  IF v_trade.requested_faab > v_team_b.faab_budget THEN
    RETURN jsonb_build_object('success', false, 'error', 'You only have €' || v_team_b.faab_budget || 'm FAAB but the deal requires €' || v_trade.requested_faab || 'm from your side.');
  END IF;

  -- 6. Validate roster size limits
  SELECT count(1) INTO v_team_a_current_size FROM public.roster_entries WHERE team_id = v_trade.team_a_id;
  SELECT count(1) INTO v_team_b_current_size FROM public.roster_entries WHERE team_id = v_trade.team_b_id;

  v_team_a_after := v_team_a_current_size - COALESCE(cardinality(v_trade.offered_players), 0) + COALESCE(cardinality(v_trade.requested_players), 0);
  v_team_b_after := v_team_b_current_size - COALESCE(cardinality(v_trade.requested_players), 0) + COALESCE(cardinality(v_trade.offered_players), 0);

  IF v_team_a_after > p_roster_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accepting this trade would put ' || v_team_a.team_name || ' over the ' || p_roster_size || '-player roster limit (they would have ' || v_team_a_after || '). They must drop a player before this trade can be accepted.');
  END IF;

  IF v_team_b_after > p_roster_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accepting this trade would put your team over the ' || p_roster_size || '-player roster limit (you would have ' || v_team_b_after || '). Drop a player first before accepting.');
  END IF;

  IF v_team_a_after < p_min_roster_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade would leave ' || v_team_a.team_name || ' below the minimum roster limit of ' || p_min_roster_size || ' players.');
  END IF;

  IF v_team_b_after < p_min_roster_size THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade would leave your team below the minimum roster limit of ' || p_min_roster_size || ' players.');
  END IF;

  -- 7. Execute transfers
  -- Move offered players from Team A -> Team B
  IF v_trade.offered_players IS NOT NULL AND cardinality(v_trade.offered_players) > 0 THEN
    UPDATE public.roster_entries
    SET team_id = v_trade.team_b_id,
        acquisition_type = 'trade',
        acquired_at = v_now
    WHERE team_id = v_trade.team_a_id
      AND player_id = ANY(v_trade.offered_players);
  END IF;

  -- Move requested players from Team B -> Team A
  IF v_trade.requested_players IS NOT NULL AND cardinality(v_trade.requested_players) > 0 THEN
    UPDATE public.roster_entries
    SET team_id = v_trade.team_a_id,
        acquisition_type = 'trade',
        acquired_at = v_now
    WHERE team_id = v_trade.team_b_id
      AND player_id = ANY(v_trade.requested_players);
  END IF;

  -- Apply FAAB adjustments
  v_team_a_new_faab := v_team_a.faab_budget - v_trade.offered_faab + v_trade.requested_faab;
  v_team_b_new_faab := v_team_b.faab_budget - v_trade.requested_faab + v_trade.offered_faab;

  UPDATE public.teams
  SET faab_budget = v_team_a_new_faab,
      updated_at = v_now
  WHERE id = v_trade.team_a_id;

  UPDATE public.teams
  SET faab_budget = v_team_b_new_faab,
      updated_at = v_now
  WHERE id = v_trade.team_b_id;

  -- Update trade status to accepted
  UPDATE public.trade_proposals
  SET status = 'accepted',
      updated_at = v_now
  WHERE id = p_trade_id;

  -- Log transactions
  -- Offered players: A traded out, B received
  IF v_trade.offered_players IS NOT NULL AND cardinality(v_trade.offered_players) > 0 THEN
    FOREACH v_player_id IN ARRAY v_trade.offered_players LOOP
      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_a_id, v_player_id, 'trade', 'Traded to ' || v_team_b.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);

      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_b_id, v_player_id, 'trade', 'Received from ' || v_team_a.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);
    END LOOP;
  END IF;

  -- Requested players: B traded out, A received
  IF v_trade.requested_players IS NOT NULL AND cardinality(v_trade.requested_players) > 0 THEN
    FOREACH v_player_id IN ARRAY v_trade.requested_players LOOP
      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_b_id, v_player_id, 'trade', 'Traded to ' || v_team_a.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);

      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_a_id, v_player_id, 'trade', 'Received from ' || v_team_b.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'team_a_id', v_trade.team_a_id,
    'team_a_name', v_team_a.team_name,
    'team_a_user_id', v_team_a.user_id,
    'team_b_id', v_trade.team_b_id,
    'team_b_name', v_team_b.team_name,
    'team_b_user_id', v_team_b.user_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_trade_transaction_rpc(uuid, int, int) FROM PUBLIC, anon, authenticated;
