-- 120: auction_state must settle with the FINAL figures, not the runner-up's.
--
-- THE BUG. `auction_state` is a projection of PENDING auction claims, rebuilt
-- by statement triggers on `waiver_claims`. `resolve_single_player_auction_rpc`
-- settles an auction in two separate statements:
--
--   1. UPDATE waiver_claims SET status='approved' WHERE id = <winner>
--   2. UPDATE waiver_claims SET status='rejected' WHERE id <> <winner>
--
-- The trigger fires after EACH. After statement 1 the anchor row is still
-- pending, so `refresh_auction_state` took its normal path and recomputed the
-- aggregates over pending claims with a team — which no longer include the
-- winner, because the winner was just approved. It wrote the RUNNER-UP as
-- `highest_bidder_team_id` (or zero/NULL when the winner was the only bidder).
-- After statement 2 the anchor is rejected, so the function hit its NOT FOUND
-- branch, set status='resolved' and returned WITHOUT touching the figures —
-- freezing statement 1's wrong values in place forever.
--
-- Measured in the live "Matchday Militia" league before this fix:
--   Romero / Canvot / Kamara / Sangaré / Groß — one real bid each, every one
--     stored as 0 bids and no winner, so the Auction Room's "Gone this week"
--     strip reported "expired — no bids" for auctions that were actually won.
--   Acheampong — really won by ChelsZ FC; stored winner was Not Too Xabi, the
--     LOSING bidder, at their losing €35m. The roster (ChelsZ FC owns him)
--     is what settles it.
--
-- THE FIX. The NOT FOUND branch now means "settled", so it computes the
-- settled truth rather than declining to look: the winner is the approved
-- claim, the price is what that claim actually bid, and the bid count is every
-- real bidder in this auction cycle.
--
-- Bounding to THIS cycle matters because a player can be auctioned more than
-- once and old rejected claims never go away. `waiver_claims` has no anchor
-- foreign key, so the cycle floor is the newest anchor row (team_id IS NULL)
-- for the pair, whatever its status — that row is created when the auction
-- opens and outlives it.
--
-- Idempotent: the UPDATE keeps its `status <> 'resolved'` guard, so only the
-- statement that actually settles the auction writes the final figures, and a
-- later trigger on the same claims cannot overwrite them.

CREATE OR REPLACE FUNCTION public.refresh_auction_state(
  p_league_id UUID,
  p_player_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_anchor        RECORD;
  v_highest_bid   INTEGER := 0;
  v_highest_team  UUID    := NULL;
  v_bid_count     INTEGER := 0;
  v_bids          JSONB   := '[]'::JSONB;
  v_kind          TEXT;
  v_seller        UUID    := NULL;
  v_cycle_start   TIMESTAMPTZ;
BEGIN
  SELECT wc.id, wc.expires_at, wc.first_bid_at, wc.sale_listing_id, wc.market_value_at_auction
  INTO v_anchor
  FROM public.waiver_claims wc
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.team_id IS NULL
    AND wc.is_auction = TRUE
    AND wc.status = 'pending';

  IF NOT FOUND THEN
    -- SETTLED. Record what actually happened instead of leaving behind
    -- whatever the previous statement's mid-resolution recount wrote.
    SELECT wc.created_at
    INTO v_cycle_start
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.team_id IS NULL
      AND wc.is_auction = TRUE
    ORDER BY wc.created_at DESC
    LIMIT 1;

    -- The winner is the approved claim. There is at most one per cycle, and
    -- none at all when the auction expired with no valid bidder.
    SELECT wc.team_id, wc.faab_bid
    INTO v_highest_team, v_highest_bid
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.is_auction = TRUE
      AND wc.team_id IS NOT NULL
      AND wc.status = 'approved'
      AND (v_cycle_start IS NULL OR wc.created_at >= v_cycle_start)
    ORDER BY wc.faab_bid DESC
    LIMIT 1;

    -- Every real bidder in this cycle, won or lost. This is what makes
    -- "3 bids" true on the settled card; the live path can only ever see the
    -- claims still pending.
    SELECT COUNT(*)
    INTO v_bid_count
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.is_auction = TRUE
      AND wc.team_id IS NOT NULL
      AND (v_cycle_start IS NULL OR wc.created_at >= v_cycle_start);

    UPDATE public.auction_state
    SET status                 = 'resolved',
        highest_bid            = COALESCE(v_highest_bid, 0),
        highest_bidder_team_id = v_highest_team,
        bid_count              = COALESCE(v_bid_count, 0),
        updated_at             = NOW()
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND status <> 'resolved';
    RETURN;
  END IF;

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
