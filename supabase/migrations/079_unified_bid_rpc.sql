-- Gaffa — Migration 079: one bid path, transactionally locked
--
-- Two auction kinds share one table and one resolver, but they had two bid
-- paths: place_auction_bid_rpc (054) for free agents, and ~150 lines of
-- hand-rolled TypeScript in listings/[listingId]/bid/route.ts for sales. The
-- TypeScript version does five unlocked statements in sequence — read highest
-- bid, insert anchor, flip the listing to active, cancel trade proposals, upsert
-- the bid — and two of the resulting holes are exploitable:
--
--   * Nothing checks the player is a free agent. /auctions/bid forwards any
--     playerId to place_auction_bid_rpc, which seeds an anchor for a ROSTERED
--     player; the resolver then hands him to the bidder without removing him
--     from his current club. On a unified board, where free agents and listed
--     players sit in one grid behind one bid button, this stops being a crafted
--     request and becomes a routing bug away from happening by accident.
--
--   * The listing lock is not atomic. Between the anchor insert and
--     cancelTradeProposalsForLockedPlayer, an offer on that same player can be
--     accepted — selling him twice. The active-listing guard in trades/route.ts
--     only runs at proposal CREATION; the accept path never re-checks.
--
-- Both fixes belong in SQL, where no route can forget them.

-- ── 1. The unified bid RPC ───────────────────────────────────
--
-- DROP then CREATE rather than CREATE OR REPLACE: the signature grows. The new
-- parameters carry defaults, so a deployed caller still passing the original
-- seven named arguments resolves to this function unchanged — which matters
-- because migrations are applied by hand and may land before the deploy.
-- (Overloading instead of dropping would make a 7-argument call ambiguous.)

DROP FUNCTION IF EXISTS public.place_auction_bid_rpc(uuid, uuid, uuid, uuid, int, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.place_auction_bid_rpc(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id UUID,
  p_drop_player_id UUID,
  p_bid_amount INT,
  p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ,
  -- Optional assertion from the caller. The function resolves the listing
  -- itself; this only lets a UI that thinks it is bidding on listing X fail
  -- loudly if the server disagrees, instead of quietly bidding on something else.
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

REVOKE EXECUTE ON FUNCTION public.place_auction_bid_rpc(uuid, uuid, uuid, uuid, int, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;


-- ── 2. Trade acceptance cannot cross a live auction ──────────
--
-- Implemented as a trigger on the status transition rather than by rewriting
-- execute_trade_transaction_rpc (075, 334 lines). Three reasons: reproducing
-- that function verbatim to insert eight lines is exactly how 062 destroyed
-- 059's work; the trigger fires inside the RPC's transaction so a RAISE still
-- rolls the whole trade back; and it equally covers the deferred path, where
-- matchupProcessor.ts replays trades after a gameweek and would otherwise need
-- the same guard bolted on separately.

CREATE OR REPLACE FUNCTION public.guard_trade_against_listings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_players UUID[];
  v_blocked TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'accepted_deferred')
     OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_players := COALESCE(NEW.offered_players, '{}'::UUID[])
            || COALESCE(NEW.requested_players, '{}'::UUID[]);

  IF array_length(v_players, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bidding has started on someone in this deal: the auction owns him now.
  SELECT string_agg(p.name, ', ')
  INTO v_blocked
  FROM public.player_sale_listings l
  JOIN public.players p ON p.id = l.player_id
  WHERE l.league_id = NEW.league_id
    AND l.status = 'active'
    AND l.player_id = ANY(v_players);

  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot complete this trade: bidding is live on %. The auction must finish first.', v_blocked
      USING ERRCODE = 'check_violation';
  END IF;

  -- Quiet listings for traded players are withdrawn — the player has moved, so
  -- the seller is no longer his owner. Their anchors go with them, or the cron
  -- would later resolve an auction for a player who has already changed club.
  UPDATE public.waiver_claims
  SET status = 'rejected'
  WHERE league_id = NEW.league_id
    AND player_id = ANY(v_players)
    AND is_auction = TRUE
    AND status = 'pending'
    AND sale_listing_id IN (
      SELECT id FROM public.player_sale_listings
      WHERE league_id = NEW.league_id
        AND status = 'pending'
        AND player_id = ANY(v_players)
    );

  UPDATE public.player_sale_listings
  SET status = 'cancelled', updated_at = NOW()
  WHERE league_id = NEW.league_id
    AND status = 'pending'
    AND player_id = ANY(v_players);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trade_against_listings ON public.trade_proposals;
CREATE TRIGGER trg_guard_trade_against_listings
  BEFORE UPDATE OF status ON public.trade_proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_trade_against_listings();


-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Signature is the 8-argument form and nothing else lingers:
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'place_auction_bid_rpc';
--   -- expect exactly one row ending in (..., timestamp with time zone, uuid)
--
--   -- Nobody is on two rosters in the same league (should be zero, always):
--   SELECT t.league_id, re.player_id, COUNT(*)
--     FROM public.roster_entries re JOIN public.teams t ON t.id = re.team_id
--    GROUP BY t.league_id, re.player_id HAVING COUNT(*) > 1;
--
-- NOTE FOR THE DEPLOY: /api/leagues/[leagueId]/auctions/bid must now resolve the
-- auction inline when the RPC returns is_buy_now — process-auctions is driven by
-- pg_cron every 10 minutes (019_auction_pgcron.sql) and is not in vercel.json.
