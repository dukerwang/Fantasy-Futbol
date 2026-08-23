-- Gaffa — Migration 132: bid_count must count bid EVENTS, not distinct bidders
--
-- THE BUG. Migration 112 added auction_bid_events as an immutable log so the
-- "Bid history" panel could show every raise, not just each team's current
-- standing bid. But refresh_auction_state kept computing bid_count the old
-- way — COUNT(*) over live waiver_claims rows, which is one row per TEAM no
-- matter how many times that team raised. The two numbers now disagree on
-- screen: AuctionsClient renders "{bid_count} bids" directly beside the
-- expanded Bid history list built from the very same auction's `bids` array,
-- so a two-team bidding war with one raise reads "2 bids" atop a history
-- panel showing three entries.
--
-- 120 made the same mistake independently in the settled branch — bid_count
-- there is COUNT(*) over waiver_claims rows created within the cycle window,
-- again one per team.
--
-- THE FIX. Both branches now count rows in auction_bid_events, which is
-- already the authoritative log the Bid history panel reads.
--   - Live: jsonb_array_length(v_bids), the same array already assembled for
--     the `bids` column two statements later — no new query.
--   - Settled: COUNT(*) FROM auction_bid_events WHERE anchor_id = <this
--     cycle's anchor row>, replacing the created_at-window heuristic over
--     waiver_claims with a direct join on the same key auction_bid_events was
--     designed around (see 112's anchor_id comment).
--
-- highest_bid / highest_bidder_team_id are untouched — "who is currently /
-- finally winning" is still correctly one-row-per-team over waiver_claims.

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
  v_cycle_anchor_id UUID;
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
    SELECT wc.id, wc.created_at
    INTO v_cycle_anchor_id, v_cycle_start
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.team_id IS NULL
      AND wc.is_auction = TRUE
    ORDER BY wc.created_at DESC
    LIMIT 1;

    -- The winner is the approved claim. There is at most one per cycle, and
    -- none at all when the auction expired with no valid bidder. Scoped to
    -- this cycle (120) because waiver_claims now has a real uniqueness
    -- constraint on (league_id, team_id, player_id) — a team that won a PRIOR
    -- cycle for this same player still owns the one row for that pair, so an
    -- unscoped lookup could resurrect a stale winner from before this cycle.
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

    -- Every bid EVENT logged against this cycle's anchor, including repeat
    -- raises from the same team — what makes "3 bids" on the settled card
    -- agree with a "Bid history" panel showing the same cycle's events, the
    -- same source refresh_auction_state's live branch already reads below.
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

  -- Every logged bid on this cycle, not just the distinct teams still
  -- standing — agrees with jsonb_array_length(v_bids) i.e. the length of the
  -- `bids` history array assembled above from the same table.
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
--   -- Every live auction's bid_count now equals its own history length:
--   SELECT player_id, bid_count, jsonb_array_length(bids) AS logged_events
--     FROM public.auction_state
--    WHERE status = 'live' AND bid_count <> jsonb_array_length(bids);
--   -- expect 0 rows
--
--   -- A settled auction's bid_count equals the event count logged against its
--   -- cycle anchor:
--   SELECT a.player_id, a.bid_count, ev.n
--     FROM public.auction_state a
--     JOIN LATERAL (
--       SELECT COUNT(*) n FROM public.auction_bid_events e
--       JOIN public.waiver_claims wc ON wc.id = e.anchor_id
--       WHERE wc.league_id = a.league_id AND wc.player_id = a.player_id
--       ORDER BY wc.created_at DESC LIMIT 1
--     ) ev ON TRUE
--    WHERE a.status = 'resolved' AND a.bid_count <> ev.n;
--   -- expect 0 rows (existing resolved rows won't have been recomputed by
--   -- this migration — this check is for auctions settled AFTER it applies)
