-- Gaffa — Migration 114: listings shaped by which prices are set
--
-- Since 080 every listing seeds a live auction anchor at creation and `min_bid`
-- is NOT NULL — there was no way to list a player without opening him to
-- competitive bidding. That surprised a manager who expected a per-listing
-- "auction vs. negotiation" choice; on inspection, no such choice ever existed
-- (077/083's gates only ever governed private Offers, never the auction path).
--
-- Rather than add a fourth toggle next to open_to_trade/sale/loan, this reuses
-- the three PRICE fields as the interface, since their presence already implies
-- a mechanism:
--
--   min_bid set        -> open auction (unchanged behaviour)
--   min_bid absent,
--     buy_now_price set -> release-clause-only: the ONLY accepted bid is one
--                          that clears the clause outright, nothing lower
--   min_bid absent,
--     buy_now_price
--     absent too        -> negotiation-only: no bid of any kind is accepted;
--                          the only door in is a private Offer
--
-- At least one of the three price fields must be set — a listing with none of
-- them is inert (nothing to shape it around, not even a stance to advertise).
--
-- WHAT DOES NOT CHANGE: a listing that already has a min_bid (i.e. every
-- listing that exists today) behaves exactly as before. This is additive.

-- ── 1. min_bid becomes optional ───────────────────────────────

ALTER TABLE public.player_sale_listings
  ALTER COLUMN min_bid DROP NOT NULL,
  ALTER COLUMN min_bid DROP DEFAULT;

COMMENT ON COLUMN public.player_sale_listings.min_bid IS
  'The auction floor. NULL means this listing has no open auction at all — see buy_now_price for whether a release-clause payment is still possible. When set, unchanged since 077: enforced at >= 80% of market value by trg_listing_min_bid_floor, and a cash offer must still clear it.';

-- ── 2. A listing must say SOMETHING ───────────────────────────
--
-- NOT VALID + separate VALIDATE: every listing on record today already has a
-- min_bid (was NOT NULL until the ALTER above), so this can be validated
-- immediately without an inspect-then-fix step.

ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_states_a_price;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_states_a_price
  CHECK (min_bid IS NOT NULL OR buy_now_price IS NOT NULL OR ask_price IS NOT NULL)
  NOT VALID;
ALTER TABLE public.player_sale_listings
  VALIDATE CONSTRAINT player_sale_listings_states_a_price;

-- player_sale_listings_buy_now_gt_min and player_sale_listings_gate_order both
-- already tolerate a NULL min_bid unchanged: Postgres CHECK constraints pass on
-- NULL (only an explicit FALSE fails them), and both expressions compare
-- against min_bid only inside a branch that already short-circuits when the
-- price being ordered is itself NULL. Nothing to touch there.

-- ── 3. The bid RPC: a NULL floor must REJECT, not wave through ─
--
-- `p_bid_amount < v_listing.min_bid` where min_bid is NULL evaluates to NULL,
-- not TRUE — an IF on that condition simply never fires, which would let a
-- listing with no stated minimum accept literally any bid, including 0. That
-- is the opposite of "not open to auction." This has to be an explicit branch.
--
-- Signature is unchanged from 112 (same 8 args) — CREATE OR REPLACE keeps the
-- existing REVOKE in place, no need to redo it.

CREATE OR REPLACE FUNCTION public.place_auction_bid_rpc(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id UUID,
  p_drop_player_id UUID,
  p_bid_amount INT,
  p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ,
  p_expect_sale_listing_id UUID DEFAULT NULL
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

  -- 5. This team's own standing bid.
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

  -- 7. Upsert this team's bid.
  IF v_my_claim_id IS NOT NULL THEN
    UPDATE public.waiver_claims
    SET faab_bid = p_bid_amount,
        drop_player_id = p_drop_player_id,
        expires_at = v_effective_expiry
    WHERE id = v_my_claim_id;
  ELSE
    INSERT INTO public.waiver_claims (
      league_id, team_id, player_id, drop_player_id, faab_bid, priority, status,
      gameweek, expires_at, is_auction, sale_listing_id
    )
    VALUES (
      p_league_id, p_team_id, p_player_id, p_drop_player_id, p_bid_amount, 999, 'pending',
      0, v_effective_expiry, TRUE,
      CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END
    );
  END IF;

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

-- ── 4. The cash-offer floor in trades/route.ts no longer applies universally ──
--
-- No DB-level change needed here: the floor check lives in application code
-- (POST /api/leagues/[leagueId]/trades), guarded by `listing.min_bid` already
-- being nullable-safe once the route is updated alongside this migration.

-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Every existing listing still has a min_bid (should equal total listing count):
--   SELECT COUNT(*) FROM public.player_sale_listings WHERE min_bid IS NOT NULL;
--
--   -- The new constraint is in place:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.player_sale_listings'::regclass
--      AND conname = 'player_sale_listings_states_a_price';
