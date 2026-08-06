-- Gaffa — Migration 112: persist every bid as an immutable event
--
-- WHY
--
-- waiver_claims holds one row per (team, player): a raise from a team that
-- already has a pending bid UPDATEs that same row in place
-- (place_auction_bid_rpc, 079, step 7) rather than appending a new one. The
-- "Bid history" panel (auction_state.bids, populated by refresh_auction_state,
-- 078) was built by aggregating waiver_claims directly — one JSON entry per
-- team, "one row per team" in that function's own comment. So after ten
-- back-and-forth raises between two managers, only the two teams' CURRENT
-- standing bids ever showed up; every intermediate raise was silently
-- overwritten before it was ever read.
--
-- This adds an append-only log that gets one INSERT per bid (including a raise
-- by a team that already has a pending bid), and repoints the bids aggregation
-- at it. highest_bid / bid_count / highest_bidder_team_id stay sourced from
-- waiver_claims — that's still "who is currently winning", which is correctly
-- one-row-per-team. Only the history list moves to the log.
--
-- Pre-existing bid history is not recoverable — the overwritten rows are gone.
-- This only fixes auctions bid on from this point forward.

-- ── 1. The log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.auction_bid_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Scopes the event to one auction CYCLE, not just (league_id, player_id): a
  -- player can be re-auctioned after a prior cycle resolves, and the anchor row
  -- (waiver_claims.id where team_id IS NULL) is recreated fresh each time
  -- (place_auction_bid_rpc step 2's ON CONFLICT target only matches a live
  -- 'pending' anchor). Keying off the anchor id instead of (league_id,
  -- player_id) keeps a new cycle's history from inheriting the previous
  -- cycle's bids.
  anchor_id   UUID NOT NULL REFERENCES public.waiver_claims(id) ON DELETE CASCADE,
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  amount      INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auction_bid_events_anchor
  ON public.auction_bid_events (anchor_id, created_at);

COMMENT ON TABLE public.auction_bid_events IS
  'Immutable log of every bid placed, including raises by a team that already has a pending bid. One row per place_auction_bid_rpc call. Source for the Bid history panel via refresh_auction_state; never updated or deleted by application code.';

ALTER TABLE public.auction_bid_events ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies on purpose, same reasoning as
-- auction_state (078): the only reader is refresh_auction_state, which is
-- SECURITY DEFINER and republishes this into the already-public
-- auction_state.bids. Nothing else should read or write this table directly.

-- ── 2. Log every bid at the point it's placed ────────────────────

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

    -- The seller's floor.
    IF p_bid_amount < v_listing.min_bid THEN
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
  --    resolver decides the winner — one settlement path, not two.
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

-- Signature is unchanged from 079 (same 8 args) — CREATE OR REPLACE keeps the
-- existing REVOKE from 079 in place, no need to redo it.

-- ── 3. Read the full history from the log, not from live waiver_claims ──

CREATE OR REPLACE FUNCTION public.refresh_auction_state(
  p_league_id UUID,
  p_player_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anchor        RECORD;
  v_highest_bid   INTEGER := 0;
  v_highest_team  UUID    := NULL;
  v_bid_count     INTEGER := 0;
  v_bids          JSONB   := '[]'::JSONB;
  v_kind          TEXT;
  v_seller        UUID    := NULL;
BEGIN
  -- The anchor is the auction. It carries the clock, and now also scopes the
  -- bid-history log to this cycle (v_anchor.id).
  SELECT wc.id, wc.expires_at, wc.first_bid_at, wc.sale_listing_id, wc.market_value_at_auction
  INTO v_anchor
  FROM public.waiver_claims wc
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.team_id IS NULL
    AND wc.is_auction = TRUE
    AND wc.status = 'pending';

  IF NOT FOUND THEN
    -- Auction is over (or never existed). Mark any row resolved rather than
    -- deleting it: Supabase does not RLS-filter postgres_changes DELETE events,
    -- and a DELETE payload carries only replica-identity columns, so the client
    -- would receive an unfiltered, contentless event. An UPDATE stays filtered
    -- and gives the board something to animate out with.
    UPDATE public.auction_state
    SET status = 'resolved', updated_at = NOW()
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND status <> 'resolved';
    RETURN;
  END IF;

  -- Current standing bid: who's winning right now, still correctly one row
  -- per team.
  SELECT
    COALESCE(MAX(wc.faab_bid), 0),
    COUNT(*)
  INTO v_highest_bid, v_bid_count
  FROM public.waiver_claims wc
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.team_id IS NOT NULL
    AND wc.is_auction = TRUE
    AND wc.status = 'pending';

  -- Full bid-by-bid history for THIS auction cycle, from the immutable log
  -- (112) — unlike waiver_claims, a team's raises don't collapse into one row.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'team_id',   e.team_id,
        'team_name', t.team_name,
        'amount',    e.amount,
        'at',        e.created_at
      )
      ORDER BY e.created_at ASC
    ),
    '[]'::JSONB
  )
  INTO v_bids
  FROM public.auction_bid_events e
  JOIN public.teams t ON t.id = e.team_id
  WHERE e.anchor_id = v_anchor.id;

  IF v_bid_count > 0 THEN
    SELECT wc.team_id INTO v_highest_team
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.team_id IS NOT NULL
      AND wc.is_auction = TRUE
      AND wc.status = 'pending'
    ORDER BY wc.faab_bid DESC, wc.created_at ASC
    LIMIT 1;
  END IF;

  IF v_anchor.sale_listing_id IS NOT NULL THEN
    v_kind := 'listing';
    SELECT seller_team_id INTO v_seller
    FROM public.player_sale_listings
    WHERE id = v_anchor.sale_listing_id;
  ELSE
    v_kind := 'free_agent';
  END IF;

  INSERT INTO public.auction_state (
    league_id, player_id, kind, status, sale_listing_id, seller_team_id,
    highest_bid, highest_bidder_team_id, bid_count, bids,
    first_bid_at, expires_at, market_value_at_auction, updated_at
  ) VALUES (
    p_league_id, p_player_id, v_kind, 'live', v_anchor.sale_listing_id, v_seller,
    v_highest_bid, v_highest_team, v_bid_count, v_bids,
    v_anchor.first_bid_at, v_anchor.expires_at, v_anchor.market_value_at_auction, NOW()
  )
  ON CONFLICT (league_id, player_id) DO UPDATE
  SET kind                    = EXCLUDED.kind,
      status                  = 'live',
      sale_listing_id         = EXCLUDED.sale_listing_id,
      seller_team_id          = EXCLUDED.seller_team_id,
      highest_bid             = EXCLUDED.highest_bid,
      highest_bidder_team_id  = EXCLUDED.highest_bidder_team_id,
      bid_count               = EXCLUDED.bid_count,
      bids                    = EXCLUDED.bids,
      first_bid_at            = EXCLUDED.first_bid_at,
      expires_at              = EXCLUDED.expires_at,
      market_value_at_auction = EXCLUDED.market_value_at_auction,
      updated_at              = NOW();
END;
$$;

-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Every bid event belongs to a still-resolvable anchor:
--   SELECT COUNT(*) FROM public.auction_bid_events e
--    LEFT JOIN public.waiver_claims wc ON wc.id = e.anchor_id
--   WHERE wc.id IS NULL;
--   -- expect 0
--
--   -- After a fresh back-and-forth bidding war, bid_count in the JSON array
--   -- should exceed auction_state.bid_count (which counts distinct teams, not
--   -- events) whenever any team raised more than once:
--   SELECT player_id, bid_count, jsonb_array_length(bids) AS logged_events
--     FROM public.auction_state WHERE status = 'live';
