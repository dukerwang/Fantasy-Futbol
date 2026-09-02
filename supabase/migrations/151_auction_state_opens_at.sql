-- ============================================================
-- Migration 151: carry opens_at into the auction_state projection
--
-- A lot seeded with a future opens_at is listed on purpose — managers are meant
-- to see it coming and plan a budget — but bidding is refused until it opens.
-- POST /auctions/bid is the only enforcement point, and it was also the only
-- place the fact existed: auction_state never carried the column, so the board
-- could not render a state it never received. A manager saw an ordinary lot,
-- pressed Bid, and learned about the wait from an error.
--
-- Staggered kickoff waves use the same field, so this is not a one-off: every
-- wave after the first is invisible in exactly the same way.
--
-- Additive and nullable. NULL means "open now", which is what every seeding
-- path except kickoff waves and the marquee midday release already writes.
-- ============================================================

ALTER TABLE public.auction_state
  ADD COLUMN IF NOT EXISTS opens_at TIMESTAMPTZ;

COMMENT ON COLUMN public.auction_state.opens_at IS
  'When bidding opens. NULL means immediately. Mirrors waiver_claims.opens_at for the anchor claim.';

-- Backfill from the anchor claim so live lots pick it up before the next
-- refresh touches them.
UPDATE public.auction_state a
SET opens_at = wc.opens_at
FROM public.waiver_claims wc
WHERE wc.league_id = a.league_id
  AND wc.player_id = a.player_id
  AND wc.team_id IS NULL
  AND wc.is_auction = TRUE
  AND wc.status = 'pending'
  AND a.opens_at IS DISTINCT FROM wc.opens_at;

-- Identical to the definition in migration 132 apart from opens_at being read
-- off the anchor and written on both the insert and the conflict update.
CREATE OR REPLACE FUNCTION public.refresh_auction_state(p_league_id uuid, p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor        RECORD;
  v_highest_bid   INTEGER := 0;
  v_highest_team  UUID    := NULL;
  v_bid_count     INTEGER := 0;
  v_bids          JSONB   := '[]'::JSONB;
  v_kind          TEXT;
  v_seller        UUID    := NULL;
  v_cycle_anchor_id UUID;
  v_cycle_start   TIMESTAMPTZ;
BEGIN
  SELECT wc.id, wc.expires_at, wc.first_bid_at, wc.sale_listing_id, wc.market_value_at_auction, wc.opens_at
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
    SELECT wc.id, wc.created_at
    INTO v_cycle_anchor_id, v_cycle_start
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.team_id IS NULL
      AND wc.is_auction = TRUE
    ORDER BY wc.created_at DESC
    LIMIT 1;

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

    SELECT COUNT(*)
    INTO v_bid_count
    FROM public.auction_bid_events e
    WHERE e.anchor_id = v_cycle_anchor_id;

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

  SELECT COALESCE(MAX(wc.faab_bid), 0)
  INTO v_highest_bid
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

  v_bid_count := jsonb_array_length(v_bids);

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
    first_bid_at, expires_at, market_value_at_auction, opens_at, updated_at
  ) VALUES (
    p_league_id, p_player_id, v_kind, 'live', v_anchor.sale_listing_id, v_seller,
    v_highest_bid, v_highest_team, v_bid_count, v_bids,
    v_anchor.first_bid_at, v_anchor.expires_at, v_anchor.market_value_at_auction,
    v_anchor.opens_at, NOW()
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
      opens_at                = EXCLUDED.opens_at,
      updated_at              = NOW();
END;
$function$;
