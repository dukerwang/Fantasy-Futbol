-- Gaffa — Migration 077: listing gates, offer linkage, and proposal privacy
--
-- Part of the unified Transfers hub. A listing stops being "an auction with an
-- optional buy-now" and becomes a menu of three gates, ordered by price:
--
--     offers  (lowest — slowest, seller confirms every deal)
--       ↓
--     auction (middle — always on, seller loses control once bidding starts)
--       ↓
--     buy now (highest — instant)
--
-- The auction is mandatory and needs no new column: it already IS the listing.
-- What the seller opts into is which kinds of *offer* they will entertain:
--
--   open_to_trade  — will listen to offers that include players
--   open_to_sale   — will listen to cash offers; requires an ask_price
--
-- Both set → "Open to Offers". This subsumes `roster_entries.on_trade_block`,
-- which said the same thing in a second, disconnected place; it is deprecated
-- here and dropped in a later migration once no deployed code reads it.
--
-- The ask_price is advertising, not a contract. Meeting it sends an offer the
-- seller still has to accept — that is the whole point of the offers gate. Only
-- buy_now_price executes on contact.

-- ── 1. Gate columns ──────────────────────────────────────────

ALTER TABLE public.player_sale_listings
  ADD COLUMN IF NOT EXISTS open_to_trade BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_to_sale  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ask_price     INTEGER;

COMMENT ON COLUMN public.player_sale_listings.open_to_trade IS
  'Seller will consider offers that include players.';
COMMENT ON COLUMN public.player_sale_listings.open_to_sale IS
  'Seller will consider cash offers. Requires ask_price.';
COMMENT ON COLUMN public.player_sale_listings.ask_price IS
  'Advertised asking price for cash offers. NOT a buy-now — meeting it still requires seller acceptance.';

-- ── 2. Price ordering ────────────────────────────────────────
--
-- buy_now must sit above the auction floor. Below it, no one would ever bid:
-- the instant price would undercut the minimum, and the floor would be dead
-- letter. This is the one ordering rule that is structurally required.
--
-- NOT VALID because listings created before this migration were only checked in
-- application code (listings/route.ts required buyNowPrice > minBid, but nothing
-- enforced it at the row level). Inspect, then validate — see the bottom of this
-- file.
ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_buy_now_gt_min;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_buy_now_gt_min
  CHECK (buy_now_price IS NULL OR buy_now_price > min_bid) NOT VALID;

-- An open_to_sale listing with no number on it is just a shrug.
ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_ask_requires_price;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_ask_requires_price
  CHECK (NOT open_to_sale OR ask_price IS NOT NULL) NOT VALID;

-- ask sits between the floor and buy-now. Below the floor it would be
-- self-defeating (bid instead); above buy-now nobody would ever negotiate.
ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_gate_order;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_gate_order
  CHECK (
    ask_price IS NULL
    OR (ask_price >= min_bid
        AND (buy_now_price IS NULL OR ask_price < buy_now_price))
  ) NOT VALID;

-- ── 3. The 80%-of-market-value floor ─────────────────────────
--
-- Stops a listing being used to hand a €90m striker to a friend for €1m. It has
-- to be a trigger, not a CHECK: CHECK cannot subquery into `players`.
--
-- The guard only fires when min_bid is actually written. Transfermarkt sync
-- overwrites players.market_value continuously, so re-validating an untouched
-- min_bid would mean a seller toggling open_to_trade on a two-week-old listing
-- gets rejected over a price they never edited — and, worse, that a listing
-- could become un-editable purely because the market moved.
--
-- Market value is otherwise only a guide in this feature. This is its one
-- mechanical role.

CREATE OR REPLACE FUNCTION public.enforce_listing_min_bid_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mv    NUMERIC;
  v_floor INT;
BEGIN
  -- Only validate a min_bid that is being set or changed.
  IF TG_OP = 'UPDATE' AND NEW.min_bid IS NOT DISTINCT FROM OLD.min_bid THEN
    RETURN NEW;
  END IF;

  SELECT market_value INTO v_mv FROM public.players WHERE id = NEW.player_id;

  -- No valuation on record: nothing to anchor to, so allow it. A player with no
  -- Transfermarkt value is not a collusion risk worth blocking a listing over.
  IF COALESCE(v_mv, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_floor := FLOOR(v_mv * 0.8);

  IF NEW.min_bid < v_floor THEN
    RAISE EXCEPTION
      'Minimum bid must be at least €%m — 80%% of this player''s €%m market value.',
      v_floor, ROUND(v_mv)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listing_min_bid_floor ON public.player_sale_listings;
CREATE TRIGGER trg_listing_min_bid_floor
  BEFORE INSERT OR UPDATE OF min_bid ON public.player_sale_listings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_min_bid_floor();

-- ── 4. Offers are trade proposals ────────────────────────────
--
-- A cash offer on a listing is a trade proposal that requests the listed player
-- and offers budget. Adding players to it makes it an ordinary trade. Rather
-- than build a parallel offers table with its own accept/reject/counter/
-- notification/deferred-execution machinery, point proposals at the listing they
-- answer and reuse all of it.

ALTER TABLE public.trade_proposals
  ADD COLUMN IF NOT EXISTS sale_listing_id UUID
  REFERENCES public.player_sale_listings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trade_proposals.sale_listing_id IS
  'Set when this proposal is an offer against a specific listing. NULL for ordinary trades.';

CREATE INDEX IF NOT EXISTS idx_trade_proposals_sale_listing
  ON public.trade_proposals (sale_listing_id)
  WHERE sale_listing_id IS NOT NULL;

-- ── 5. Proposal privacy, before Realtime publishes this table ─
--
-- The existing policy (012:40-47) lets any league member SELECT every proposal
-- in the league. That was latent — every read in src/ goes through the
-- service-role client, so no browser ever exercised it. Migration 078 puts this
-- table on the Realtime publication, at which point the policy becomes the thing
-- deciding what gets pushed to subscribers' websockets, and league-wide read
-- would mean everyone watching everyone else's live negotiations.
--
-- Settled deals stay public: the league feed is built from accepted trades and
-- is meant to be read by everyone.

DROP POLICY IF EXISTS "Trade proposals: read if league member" ON public.trade_proposals;
DROP POLICY IF EXISTS "Trade proposals: read own or settled" ON public.trade_proposals;

CREATE POLICY "Trade proposals: read own or settled"
  ON public.trade_proposals FOR SELECT
  USING (
    -- A party to the deal sees it at every stage.
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id IN (trade_proposals.team_a_id, trade_proposals.team_b_id)
        AND t.user_id = auth.uid()
    )
    OR (
      -- Everyone else sees it once it is history.
      trade_proposals.status IN ('accepted', 'accepted_deferred')
      AND EXISTS (
        SELECT 1 FROM public.league_members lm
        WHERE lm.league_id = trade_proposals.league_id
          AND lm.user_id = auth.uid()
      )
    )
  );

-- The policy above filters on teams(id, user_id) per subscriber per change.
CREATE INDEX IF NOT EXISTS idx_teams_user_id ON public.teams (user_id);

-- ── 6. Deprecate the trade block ─────────────────────────────
--
-- Superseded by open_to_trade / open_to_sale. Not dropped here: migrations are
-- applied by hand and may land before the deploy that stops reading this column.
-- The DROP ships in a later migration, after the reading code is gone.

COMMENT ON COLUMN public.roster_entries.on_trade_block IS
  'DEPRECATED — superseded by player_sale_listings.open_to_trade / open_to_sale. Dropped in a later migration.';


-- ============================================================
-- POST-APPLY: validate the NOT VALID constraints
-- ============================================================
--
-- Each was added NOT VALID so this file cannot fail on pre-existing rows. Check
-- each returns zero, then validate. If a query returns rows, fix the data first
-- — do not skip the validation.
--
--   -- buy_now at or below the auction floor:
--   SELECT id, player_id, min_bid, buy_now_price FROM public.player_sale_listings
--    WHERE buy_now_price IS NOT NULL AND buy_now_price <= min_bid;
--
--   -- open_to_sale with no ask (cannot exist yet — both columns are new):
--   SELECT id FROM public.player_sale_listings WHERE open_to_sale AND ask_price IS NULL;
--
--   -- ask outside the gate ordering (likewise cannot exist yet):
--   SELECT id, min_bid, ask_price, buy_now_price FROM public.player_sale_listings
--    WHERE ask_price IS NOT NULL
--      AND (ask_price < min_bid OR (buy_now_price IS NOT NULL AND ask_price >= buy_now_price));
--
-- Then:
--   ALTER TABLE public.player_sale_listings VALIDATE CONSTRAINT player_sale_listings_buy_now_gt_min;
--   ALTER TABLE public.player_sale_listings VALIDATE CONSTRAINT player_sale_listings_ask_requires_price;
--   ALTER TABLE public.player_sale_listings VALIDATE CONSTRAINT player_sale_listings_gate_order;
--
-- Note the 80% floor is deliberately NOT retro-applied to existing listings.
-- Sellers priced them under the old rules; the trigger binds them only if and
-- when they next edit min_bid.
