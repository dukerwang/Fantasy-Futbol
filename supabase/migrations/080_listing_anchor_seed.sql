-- Gaffa — Migration 080: every listing is an auction from the moment it exists
--
-- ⚠️ APPLY ONLY AFTER 076 AND 079 ARE APPLIED AND VERIFIED.
--    This migration creates auction anchors for listed (i.e. rostered) players.
--    Under the 062 regression the resolver hands such a player to the winner
--    WITHOUT removing him from the seller — so seeding anchors before 076 is in
--    place turns a latent bug into duplicated rosters at scale. 079 supplies the
--    free-agent guard that keeps the two auction kinds from being confused.
--
-- Until now the anchor row — the thing that actually holds the clock — was
-- created lazily by the first bid. That left a listing in a strange half-state:
-- advertised on the board, but with no auction behind it and nothing for the
-- realtime projection to key on. The new model says a listing IS a commitment to
-- sell, so the auction exists from the start and the 14-day window is the
-- auction's own expiry rather than a separate sweep.
--
-- Side effect worth noting: this retires the bespoke stale-listing sweep at the
-- top of /api/cron/process-auctions. A listing that attracts no bids now expires
-- through the ordinary resolver — its anchor comes due, the no-winner branch
-- fires, claims are rejected and the listing is marked 'expired'. One code path
-- instead of two.

-- ── 1. Seed the anchor when a listing is created ─────────────

CREATE OR REPLACE FUNCTION public.seed_listing_auction_anchor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_market_value NUMERIC;
BEGIN
  -- Only listings that are open for business.
  IF NEW.status NOT IN ('pending', 'active') THEN
    RETURN NEW;
  END IF;

  SELECT market_value INTO v_market_value FROM public.players WHERE id = NEW.player_id;

  INSERT INTO public.waiver_claims (
    league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction,
    expires_at, first_bid_at, last_bid_at, sale_listing_id, market_value_at_auction
  ) VALUES (
    NEW.league_id, NULL, NEW.player_id, 0, 999, 'pending', 0, TRUE,
    -- The listing's own shelf life. Once a bid lands, place_auction_bid_rpc
    -- replaces this with the activity timer from src/lib/auction/timer.ts.
    NEW.created_at + INTERVAL '14 days',
    -- NULL until a real bid: the activity timer keys its 24h minimum off
    -- first_bid_at, and a seeded anchor has not been bid on.
    NULL, NULL,
    NEW.id,
    NULLIF(COALESCE(v_market_value, 0), 0)
  )
  ON CONFLICT (league_id, player_id)
    WHERE (team_id IS NULL AND status = 'pending'::public.waiver_claim_status AND is_auction = TRUE)
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_listing_auction_anchor ON public.player_sale_listings;
CREATE TRIGGER trg_seed_listing_auction_anchor
  AFTER INSERT ON public.player_sale_listings
  FOR EACH ROW EXECUTE FUNCTION public.seed_listing_auction_anchor();

-- ── 2. Withdrawing a listing withdraws its auction ───────────
--
-- Scoped to 'cancelled' on purpose. 'sold' and 'expired' are written by
-- resolve_single_player_auction_rpc, which already settles every claim itself;
-- firing here too would mean two things racing to write the same rows in the
-- same transaction. 'cancelled' is the one transition the resolver never makes —
-- it comes from the seller withdrawing, or from the trade guard in 079 — and
-- without this the orphaned anchor stays pending until the cron resolves an
-- auction for a player who is no longer for sale.

CREATE OR REPLACE FUNCTION public.withdraw_listing_auction_anchor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  UPDATE public.waiver_claims
  SET status = 'rejected'
  WHERE league_id = NEW.league_id
    AND player_id = NEW.player_id
    AND is_auction = TRUE
    AND status = 'pending'
    AND sale_listing_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdraw_listing_auction_anchor ON public.player_sale_listings;
CREATE TRIGGER trg_withdraw_listing_auction_anchor
  AFTER UPDATE OF status ON public.player_sale_listings
  FOR EACH ROW EXECUTE FUNCTION public.withdraw_listing_auction_anchor();

-- ── 3. Backfill anchors for listings that predate this ───────
--
-- Without this, every listing already on the board would show no auction and no
-- clock after deploy. Existing 'active' listings already have an anchor (their
-- first bid made one) and are skipped by the conflict clause.

DO $$
DECLARE
  r RECORD;
  v_seeded INT := 0;
BEGIN
  FOR r IN
    SELECT l.id, l.league_id, l.player_id, l.created_at, p.market_value
    FROM public.player_sale_listings l
    JOIN public.players p ON p.id = l.player_id
    WHERE l.status IN ('pending', 'active')
  LOOP
    INSERT INTO public.waiver_claims (
      league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction,
      expires_at, first_bid_at, last_bid_at, sale_listing_id, market_value_at_auction
    ) VALUES (
      r.league_id, NULL, r.player_id, 0, 999, 'pending', 0, TRUE,
      -- Give backfilled listings a fresh 14 days rather than a window that may
      -- already have elapsed — otherwise applying this migration would instantly
      -- expire every old listing at the next cron tick.
      GREATEST(r.created_at + INTERVAL '14 days', NOW() + INTERVAL '14 days'),
      NULL, NULL, r.id,
      NULLIF(COALESCE(r.market_value, 0), 0)
    )
    ON CONFLICT (league_id, player_id)
      WHERE (team_id IS NULL AND status = 'pending'::public.waiver_claim_status AND is_auction = TRUE)
    DO NOTHING;

    v_seeded := v_seeded + 1;
  END LOOP;

  RAISE NOTICE 'Considered % open listing(s) for anchor backfill.', v_seeded;
END $$;

-- The backfill wrote through the waiver_claims triggers from 078, so
-- auction_state is already current. Belt and braces for anything the conflict
-- clause skipped:
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT league_id, player_id
    FROM public.waiver_claims
    WHERE is_auction = TRUE AND status = 'pending' AND team_id IS NULL
  LOOP
    PERFORM public.refresh_auction_state(r.league_id, r.player_id);
  END LOOP;
END $$;


-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Every open listing has exactly one anchor (should return zero rows):
--   SELECT l.id, l.player_id
--     FROM public.player_sale_listings l
--    WHERE l.status IN ('pending','active')
--      AND NOT EXISTS (
--        SELECT 1 FROM public.waiver_claims wc
--         WHERE wc.sale_listing_id = l.id AND wc.team_id IS NULL
--           AND wc.is_auction AND wc.status = 'pending');
--
--   -- Every open listing shows on the board (should return zero rows):
--   SELECT l.id FROM public.player_sale_listings l
--    WHERE l.status IN ('pending','active')
--      AND NOT EXISTS (SELECT 1 FROM public.auction_state a
--                       WHERE a.league_id = l.league_id AND a.player_id = l.player_id
--                         AND a.status = 'live' AND a.kind = 'listing');
--
--   -- No anchor outlives its listing (should return zero rows):
--   SELECT wc.id FROM public.waiver_claims wc
--     JOIN public.player_sale_listings l ON l.id = wc.sale_listing_id
--    WHERE wc.status = 'pending' AND wc.is_auction AND wc.team_id IS NULL
--      AND l.status NOT IN ('pending','active');
--
-- FOLLOW-UP FOR THE DEPLOY: the stale-listing sweep at the top of
-- /api/cron/process-auctions (the block that expires 'pending' listings older
-- than 14 days) is now redundant — the anchor expiry drives it. Removing it is
-- optional; leaving it in place is harmless but means two mechanisms agree on
-- the same 14 days, which will drift the moment one is edited.
