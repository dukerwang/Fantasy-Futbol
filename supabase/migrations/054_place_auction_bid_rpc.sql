-- ============================================================
-- Migration 054: Atomic Place Auction Bid RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.place_auction_bid_rpc(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id UUID,
  p_drop_player_id UUID,
  p_bid_amount INT,
  p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_system_seed_id UUID;
  v_highest_team_id UUID;
  v_highest_bid INT := 0;
  v_my_claim_id UUID;
  v_my_current_bid INT := 0;
  v_prev_highest_team_id UUID := NULL;
  v_prev_highest_bid INT := 0;
  v_prev_highest_team_name TEXT := '';
  v_prev_highest_user_id UUID := NULL;
  v_prev_highest_email TEXT := '';
BEGIN
  -- 1. Ensure the system-seed claim row exists (team_id IS NULL)
  -- If it doesn't, insert it.
  INSERT INTO public.waiver_claims (
    league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction, expires_at, first_bid_at, last_bid_at
  )
  VALUES (
    p_league_id, NULL, p_player_id, 0, 999, 'pending', 0, TRUE, p_expires_at, p_now, p_now
  )
  ON CONFLICT (league_id, player_id) WHERE (team_id IS NULL AND status = 'pending'::public.waiver_claim_status AND is_auction = TRUE)
  DO NOTHING;

  -- 2. Lock the system-seed row to serialize concurrent bids for this player
  SELECT id
  INTO v_system_seed_id
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending'
  FOR UPDATE;

  -- 3. Find current highest bidder and their bid BEFORE inserting
  SELECT wc.team_id, wc.faab_bid, t.team_name, t.user_id, u.email
  INTO v_highest_team_id, v_highest_bid, v_prev_highest_team_name, v_prev_highest_user_id, v_prev_highest_email
  FROM public.waiver_claims wc
  JOIN public.teams t ON t.id = wc.team_id
  JOIN public.users u ON u.id = t.user_id
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.status = 'pending'
    AND wc.is_auction = TRUE
    AND wc.team_id IS NOT NULL
  ORDER BY wc.faab_bid DESC
  LIMIT 1;

  -- 4. Check user's own current bid
  SELECT id, faab_bid
  INTO v_my_claim_id, v_my_current_bid
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id = p_team_id
    AND status = 'pending'
    AND is_auction = TRUE;

  -- 5. Validation: Bid must exceed highest bid
  IF v_highest_team_id IS NOT NULL AND v_highest_team_id <> p_team_id AND p_bid_amount <= v_highest_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid must be greater than the current highest bid of €' || v_highest_bid || 'm');
  END IF;

  -- 6. Validation: If user is raising their own highest bid, it must exceed their current bid
  IF v_my_claim_id IS NOT NULL AND p_bid_amount <= v_my_current_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your new bid must be greater than your current bid of €' || v_my_current_bid || 'm');
  END IF;

  -- 7. Upsert the bid
  IF v_my_claim_id IS NOT NULL THEN
    UPDATE public.waiver_claims
    SET faab_bid = p_bid_amount,
        drop_player_id = p_drop_player_id,
        expires_at = p_expires_at
    WHERE id = v_my_claim_id;
  ELSE
    INSERT INTO public.waiver_claims (
      league_id, team_id, player_id, drop_player_id, faab_bid, priority, status, gameweek, expires_at, is_auction
    )
    VALUES (
      p_league_id, p_team_id, p_player_id, p_drop_player_id, p_bid_amount, 999, 'pending', 0, p_expires_at, TRUE
    );
  END IF;

  -- 8. Update system-seed row metadata
  UPDATE public.waiver_claims
  SET last_bid_at = p_now,
      expires_at = p_expires_at,
      first_bid_at = COALESCE(first_bid_at, p_now)
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- 9. Propagate the recalculated expiry to all other pending real bids
  UPDATE public.waiver_claims
  SET expires_at = p_expires_at
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NOT NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- If there was a previous highest bidder who got outbid, populate outbid details
  IF v_highest_team_id IS NOT NULL AND v_highest_team_id <> p_team_id THEN
    v_prev_highest_team_id := v_highest_team_id;
    v_prev_highest_bid := v_highest_bid;
  ELSE
    v_prev_highest_team_id := NULL;
    v_prev_highest_bid := 0;
    v_prev_highest_team_name := '';
    v_prev_highest_user_id := NULL;
    v_prev_highest_email := '';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'outbid_team_id', v_prev_highest_team_id,
    'outbid_team_name', v_prev_highest_team_name,
    'outbid_team_user_id', v_prev_highest_user_id,
    'outbid_user_email', v_prev_highest_email,
    'previous_highest_bid', v_prev_highest_bid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_auction_bid_rpc(uuid, uuid, uuid, uuid, int, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
