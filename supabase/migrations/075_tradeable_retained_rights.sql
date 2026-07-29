-- Gaffa — Migration 075: make retained rights tradeable
--
-- Retained rights are a dynasty asset: a claim on a player who is outside the
-- Premier League, which matures into a free roster spot if he ever comes back.
-- Managers value that claim differently — one rates the player, another needs
-- the slot — so it should be tradeable like anything else.
--
-- Rights are carried as `departure_decisions.id`, not player ids. A player can
-- have several historical decision rows in one league (he can depart, return,
-- and depart again), so only the row id identifies which claim is being moved.
--
-- Two things deliberately do NOT move with the trade:
--
--   * `original_team_id` stays put. It is the identity the buy-back exclusion
--     is enforced against — the manager who took compensation for a player
--     cannot bid on his return auction. If that moved with the rights, a
--     manager could release a player, trade the resulting claim to a friend,
--     and buy back in via the auction with the exclusion laundered off.
--   * The status and any live reinstatement deadline stay put. Trading a right
--     that is already in its return window is allowed — "I can't fit him, you
--     take him" is a real deal — but the clock does not reset. The buyer
--     inherits the deadline as it stands, which is visible to them.
--
-- Rights consume retained slots, not roster places, so the roster-size maths in
-- the trade RPC is untouched; a separate slot check is added instead.

ALTER TABLE public.trade_proposals
  ADD COLUMN IF NOT EXISTS offered_rights   UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requested_rights UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.trade_proposals.offered_rights IS
  'departure_decisions.id values team A is offering — retained player rights, not roster players.';
COMMENT ON COLUMN public.trade_proposals.requested_rights IS
  'departure_decisions.id values team A is requesting from team B.';

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
  v_right_id UUID;
  v_team_a_new_faab INT;
  v_team_b_new_faab INT;
  v_offered_rights_n INT;
  v_requested_rights_n INT;
  v_retained_slots INT;
  v_team_a_slots_used INT;
  v_team_b_slots_used INT;
  v_now TIMESTAMPTZ := NOW();
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

  -- 4b. Verify retained rights are still live and still held by the right team.
  -- A right can lapse between proposal and acceptance: the return window can
  -- expire, or the holder can relinquish it. Either way the deal is stale.
  v_offered_rights_n := COALESCE(cardinality(v_trade.offered_rights), 0);
  v_requested_rights_n := COALESCE(cardinality(v_trade.requested_rights), 0);

  IF v_offered_rights_n > 0 THEN
    SELECT count(1)
    INTO v_team_a_match_count
    FROM public.departure_decisions
    WHERE id = ANY(v_trade.offered_rights)
      AND team_id = v_trade.team_a_id
      AND league_id = v_trade.league_id
      AND status IN ('retained', 'return_pending');

    IF v_team_a_match_count <> v_offered_rights_n THEN
      RETURN jsonb_build_object('success', false, 'error', 'One or more offered player rights are no longer held by the proposing team. The trade cannot be completed.');
    END IF;
  END IF;

  IF v_requested_rights_n > 0 THEN
    SELECT count(1)
    INTO v_team_b_match_count
    FROM public.departure_decisions
    WHERE id = ANY(v_trade.requested_rights)
      AND team_id = v_trade.team_b_id
      AND league_id = v_trade.league_id
      AND status IN ('retained', 'return_pending');

    IF v_team_b_match_count <> v_requested_rights_n THEN
      RETURN jsonb_build_object('success', false, 'error', 'One or more requested player rights are no longer held by your team. The trade cannot be completed.');
    END IF;
  END IF;

  -- 5. Validate FAAB budgets
  IF v_trade.offered_faab > v_team_a.faab_budget THEN
    RETURN jsonb_build_object('success', false, 'error', 'The proposing team only has €' || v_team_a.faab_budget || 'm FAAB but offered €' || v_trade.offered_faab || 'm. The trade cannot be completed.');
  END IF;

  IF v_trade.requested_faab > v_team_b.faab_budget THEN
    RETURN jsonb_build_object('success', false, 'error', 'You only have €' || v_team_b.faab_budget || 'm FAAB but the deal requires €' || v_trade.requested_faab || 'm from your side.');
  END IF;

  -- 6. Validate roster size limits.
  -- Rights are excluded by construction: they have no roster_entries row, so
  -- they cannot push either side over the squad limit.
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

  -- 6b. Validate retained slot limits. Rights consume a scarce slot, and the
  -- slot allowance is what stops a manager hoarding claims — a trade must not
  -- be a way around it.
  IF v_offered_rights_n > 0 OR v_requested_rights_n > 0 THEN
    SELECT COALESCE(retained_slots, 0) INTO v_retained_slots
    FROM public.leagues WHERE id = v_trade.league_id;

    SELECT count(1) INTO v_team_a_slots_used
    FROM public.departure_decisions
    WHERE team_id = v_trade.team_a_id AND status IN ('retained', 'return_pending');

    SELECT count(1) INTO v_team_b_slots_used
    FROM public.departure_decisions
    WHERE team_id = v_trade.team_b_id AND status IN ('retained', 'return_pending');

    IF (v_team_a_slots_used - v_offered_rights_n + v_requested_rights_n) > v_retained_slots THEN
      RETURN jsonb_build_object('success', false, 'error', 'Accepting this trade would put ' || v_team_a.team_name || ' over the ' || v_retained_slots || ' retained-rights limit. They must relinquish rights to another player first.');
    END IF;

    IF (v_team_b_slots_used - v_requested_rights_n + v_offered_rights_n) > v_retained_slots THEN
      RETURN jsonb_build_object('success', false, 'error', 'Accepting this trade would put your team over the ' || v_retained_slots || ' retained-rights limit. Relinquish rights to another player first.');
    END IF;
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

  -- Move rights. Only team_id changes: original_team_id carries the buy-back
  -- exclusion and must not be laundered, and any live return deadline stands.
  IF v_offered_rights_n > 0 THEN
    UPDATE public.departure_decisions
    SET team_id = v_trade.team_b_id,
        updated_at = v_now
    WHERE id = ANY(v_trade.offered_rights)
      AND team_id = v_trade.team_a_id;
  END IF;

  IF v_requested_rights_n > 0 THEN
    UPDATE public.departure_decisions
    SET team_id = v_trade.team_a_id,
        updated_at = v_now
    WHERE id = ANY(v_trade.requested_rights)
      AND team_id = v_trade.team_b_id;
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

  -- Rights changing hands, logged against the player they are a claim on.
  IF v_offered_rights_n > 0 THEN
    FOR v_right_id, v_player_id IN
      SELECT id, player_id FROM public.departure_decisions WHERE id = ANY(v_trade.offered_rights)
    LOOP
      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_a_id, v_player_id, 'trade', 'Retained rights traded to ' || v_team_b.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);

      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_b_id, v_player_id, 'trade', 'Received retained rights from ' || v_team_a.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);
    END LOOP;
  END IF;

  IF v_requested_rights_n > 0 THEN
    FOR v_right_id, v_player_id IN
      SELECT id, player_id FROM public.departure_decisions WHERE id = ANY(v_trade.requested_rights)
    LOOP
      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_b_id, v_player_id, 'trade', 'Retained rights traded to ' || v_team_a.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);

      INSERT INTO public.transactions (league_id, team_id, player_id, type, notes, processed_at, created_at)
      VALUES (v_trade.league_id, v_trade.team_a_id, v_player_id, 'trade', 'Received retained rights from ' || v_team_b.team_name || ' (trade #' || substring(p_trade_id::text from 1 for 8) || ')', v_now, v_now);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'team_a_id', v_trade.team_a_id,
    'team_a_name', v_team_a.team_name,
    'team_a_user_id', v_team_a.user_id,
    'team_b_id', v_trade.team_b_id,
    'team_b_name', v_team_b.team_name,
    'team_b_user_id', v_team_b.user_id,
    'rights_moved', v_offered_rights_n + v_requested_rights_n
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_trade_transaction_rpc(uuid, int, int) FROM PUBLIC, anon, authenticated;
