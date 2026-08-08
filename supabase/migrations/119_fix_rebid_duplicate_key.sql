-- Gaffa — Migration 119: fix "duplicate waiver" error on re-bidding a player
--
-- place_auction_bid_rpc decided UPDATE-vs-INSERT for a team's own bid by
-- looking for an existing row with status = 'pending' only. But the table's
-- actual uniqueness constraint doesn't care about status at all:
--
--   CREATE UNIQUE INDEX waiver_claims_league_team_player_unique
--     ON public.waiver_claims (league_id, team_id, player_id)
--
-- Once a team's claim on a given player is resolved to any terminal state
-- (rejected — whether outbid or lost to a full roster — or approved), the
-- pending-only lookup no longer finds it, so the next bid attempt falls into
-- the INSERT branch and collides with that old row: a raw
-- "duplicate key value violates unique constraint" surfaces to the bidder.
-- The team is then permanently unable to ever bid on that player again in
-- this league.
--
-- Confirmed 2026-08-08: ChelsZ FC's rejected bid on Pascal Groß (rejected for
-- roster_full, see 115/117) blocked every later bid attempt on Groß with
-- exactly this error. The same collision happens for an ordinary competitive
-- loss (outbid), not just a roster-space rejection — this is a core-path bug,
-- not an edge case.
--
-- Fix: make the write in step 7 a real upsert against the actual unique
-- index, so a pre-existing resolved row is reactivated as a fresh pending
-- bid instead of colliding with a plain INSERT. The step-5 pending-only
-- lookup is untouched — it still correctly answers "do I have a live bid to
-- beat" for the step-6 minimum-raise check, which should NOT be affected by
-- a bid that already resolved.

CREATE OR REPLACE FUNCTION public.place_auction_bid_rpc(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id UUID,
  p_drop_player_id UUID,
  p_bid_amount INT,
  p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ,
  p_expect_sale_listing_id UUID DEFAULT NULL,
  p_send_to_academy BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  v_listing RECORD;
  v_is_listing BOOLEAN := FALSE;
  v_is_buy_now BOOLEAN := FALSE;
  v_effective_expiry TIMESTAMPTZ;
  v_market_value NUMERIC;
  v_cancelled_trades INT := 0;
BEGIN
  -- Mutually exclusive — a bid nominates a drop OR requests academy routing,
  -- never both.
  IF p_drop_player_id IS NOT NULL AND p_send_to_academy THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Cannot nominate a drop player and request academy routing on the same bid.');
  END IF;

  -- 0. Resolve which kind of auction this is. Locked, so a concurrent cancel or
  --    price edit cannot change the terms underneath this bid.
  SELECT l.id, l.seller_team_id, l.min_bid, l.buy_now_price, l.status
  INTO v_listing
  FROM public.player_sale_listings l
  WHERE l.league_id = p_league_id
    AND l.player_id = p_player_id
    AND l.status IN ('pending', 'active')
  FOR UPDATE;

  v_is_listing := FOUND;

  IF p_expect_sale_listing_id IS NOT NULL
     AND (NOT v_is_listing OR v_listing.id <> p_expect_sale_listing_id) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'This listing is no longer available. Refresh and try again.');
  END IF;

  IF v_is_listing THEN
    -- A seller cannot buy back their own listing.
    IF v_listing.seller_team_id = p_team_id THEN
      RETURN jsonb_build_object('success', false,
        'error', 'You cannot bid on your own listing.');
    END IF;

    IF v_listing.min_bid IS NULL THEN
      -- No auction floor: this listing is either release-clause-only or
      -- negotiation-only. Either way, the ONLY bid Postgres will accept here is
      -- one that clears the clause outright — anything else, including a bid
      -- amount of 0, is rejected. `< NULL` would silently never be TRUE, which
      -- is why this can't just fall through to the ordinary floor check below.
      IF v_listing.buy_now_price IS NULL OR p_bid_amount < v_listing.buy_now_price THEN
        RETURN jsonb_build_object('success', false,
          'error', 'This player is not open to auction bids. Pay the release clause in full, or send an Offer to negotiate instead.');
      END IF;
    ELSIF p_bid_amount < v_listing.min_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Bid must be at least the minimum of €' || v_listing.min_bid || 'm.');
    END IF;
  ELSE
    -- FREE-AGENT GUARD. No listing means this must be an unowned player. Without
    -- this, a bid on a rostered player seeds an auction for someone else's
    -- signing and the resolver duplicates him across two rosters.
    IF EXISTS (
      SELECT 1
      FROM public.roster_entries re
      JOIN public.teams t ON t.id = re.team_id
      WHERE t.league_id = p_league_id
        AND re.player_id = p_player_id
    ) THEN
      RETURN jsonb_build_object('success', false,
        'error', 'That player is on a club''s roster and is not listed for sale.');
    END IF;
  END IF;

  SELECT market_value INTO v_market_value FROM public.players WHERE id = p_player_id;

  -- 1. Buy Now. A bid at or above the instant price ends the auction now rather
  --    than extending it. Implemented as an immediate expiry so the ordinary
  --    resolver decides the winner — one settlement path, not two. When
  --    min_bid is NULL the gate above already guaranteed p_bid_amount clears
  --    buy_now_price, so this always evaluates TRUE in that case.
  IF v_is_listing
     AND v_listing.buy_now_price IS NOT NULL
     AND p_bid_amount >= v_listing.buy_now_price THEN
    v_is_buy_now := TRUE;
    v_effective_expiry := p_now - INTERVAL '1 second';
  ELSE
    v_effective_expiry := p_expires_at;
  END IF;

  -- 2. Ensure the anchor exists. From migration 080 listings are seeded with one
  --    at creation, so for those this is a no-op; free agents are born here.
  INSERT INTO public.waiver_claims (
    league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction,
    expires_at, first_bid_at, last_bid_at, sale_listing_id, market_value_at_auction
  )
  VALUES (
    p_league_id, NULL, p_player_id, 0, 999, 'pending', 0, TRUE,
    v_effective_expiry, p_now, p_now,
    CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
    NULLIF(COALESCE(v_market_value, 0), 0)
  )
  ON CONFLICT (league_id, player_id)
    WHERE (team_id IS NULL AND status = 'pending'::public.waiver_claim_status AND is_auction = TRUE)
  DO NOTHING;

  -- 3. Lock the anchor to serialize concurrent bids on this player.
  SELECT id INTO v_system_seed_id
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending'
  FOR UPDATE;

  -- 4. Current highest bidder, read before we insert.
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

  -- 5. This team's own standing (pending) bid — used only for the step-6
  --    minimum-raise check. A previously resolved claim (rejected or
  --    approved) intentionally does not show up here: there is no live bid
  --    of theirs left to beat.
  SELECT id, faab_bid INTO v_my_claim_id, v_my_current_bid
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id = p_team_id
    AND status = 'pending'
    AND is_auction = TRUE;

  -- 6. Must beat the field. Skipped for Buy Now, which by construction already
  --    clears any bid the auction could legally hold.
  IF NOT v_is_buy_now THEN
    IF v_highest_team_id IS NOT NULL AND v_highest_team_id <> p_team_id AND p_bid_amount <= v_highest_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Bid must be greater than the current highest bid of €' || v_highest_bid || 'm');
    END IF;

    IF v_my_claim_id IS NOT NULL AND p_bid_amount <= v_my_current_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Your new bid must be greater than your current bid of €' || v_my_current_bid || 'm');
    END IF;
  END IF;

  -- 7. Upsert this team's bid against the table's REAL uniqueness constraint
  --    (league_id, team_id, player_id) — not just the pending subset step 5
  --    looked at. A row already sitting there from a past resolved claim
  --    (rejected or approved) is reactivated as a fresh pending bid instead
  --    of colliding with a bare INSERT.
  INSERT INTO public.waiver_claims (
    league_id, team_id, player_id, drop_player_id, faab_bid, priority, status,
    gameweek, expires_at, is_auction, sale_listing_id, send_to_academy
  )
  VALUES (
    p_league_id, p_team_id, p_player_id, p_drop_player_id, p_bid_amount, 999, 'pending',
    0, v_effective_expiry, TRUE,
    CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
    p_send_to_academy
  )
  ON CONFLICT (league_id, team_id, player_id) DO UPDATE
  SET drop_player_id = EXCLUDED.drop_player_id,
      faab_bid = EXCLUDED.faab_bid,
      priority = EXCLUDED.priority,
      status = 'pending',
      gameweek = EXCLUDED.gameweek,
      expires_at = EXCLUDED.expires_at,
      is_auction = TRUE,
      sale_listing_id = EXCLUDED.sale_listing_id,
      send_to_academy = EXCLUDED.send_to_academy;

  -- 7b. Log this bid as an immutable event. waiver_claims itself only ever
  --     holds this team's CURRENT bid (the upsert above overwrites in place on
  --     a raise) — this is the only durable record that a raise ever happened,
  --     and it's what the Bid history panel now reads (see refresh_auction_state).
  INSERT INTO public.auction_bid_events (anchor_id, league_id, player_id, team_id, amount)
  VALUES (v_system_seed_id, p_league_id, p_player_id, p_team_id, p_bid_amount);

  -- 8. Anchor metadata: the activity timer restarts from this bid.
  UPDATE public.waiver_claims
  SET last_bid_at = p_now,
      expires_at = v_effective_expiry,
      first_bid_at = COALESCE(first_bid_at, p_now)
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- 9. Propagate the expiry to every other standing bid, so the whole group
  --    resolves together.
  UPDATE public.waiver_claims
  SET expires_at = v_effective_expiry
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NOT NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- 10. THE LOCK. First bid on a quiet listing commits the player: the seller
  --     can no longer cancel, and every open negotiation for him dies here — in
  --     this transaction, not in a follow-up statement a concurrent accept could
  --     slip past.
  IF v_is_listing AND v_listing.status = 'pending' THEN
    UPDATE public.player_sale_listings
    SET status = 'active',
        auction_expires_at = v_effective_expiry,
        updated_at = p_now
    WHERE id = v_listing.id;

    WITH cancelled AS (
      UPDATE public.trade_proposals
      SET status = 'cancelled', updated_at = p_now
      WHERE league_id = p_league_id
        AND status = 'pending'
        AND (offered_players @> ARRAY[p_player_id]
             OR requested_players @> ARRAY[p_player_id])
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_cancelled_trades FROM cancelled;

  ELSIF v_is_listing THEN
    UPDATE public.player_sale_listings
    SET auction_expires_at = v_effective_expiry,
        updated_at = p_now
    WHERE id = v_listing.id;
  END IF;

  -- Outbid bookkeeping for the notification the route sends.
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
    'is_listing', v_is_listing,
    'sale_listing_id', CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
    'seller_team_id', CASE WHEN v_is_listing THEN v_listing.seller_team_id ELSE NULL END,
    -- The route must resolve the auction inline when this is true. Buy Now that
    -- waits on the 10-minute pg_cron sweep is not "instant".
    'is_buy_now', v_is_buy_now,
    'expires_at', v_effective_expiry,
    'cancelled_trade_count', v_cancelled_trades,
    'outbid_team_id', v_prev_highest_team_id,
    'outbid_team_name', v_prev_highest_team_name,
    'outbid_team_user_id', v_prev_highest_user_id,
    'outbid_user_email', v_prev_highest_email,
    'previous_highest_bid', v_prev_highest_bid
  );
END;
$$;
