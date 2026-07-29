-- Gaffa — Migration 082: backfill listing gates, and forbid inert listings
--
-- 077 added open_to_trade / open_to_sale as NOT NULL DEFAULT FALSE and did not
-- backfill. Every listing that existed before 077 therefore became INERT: it is
-- still on the board, but it advertises that the seller will entertain neither a
-- player offer nor a cash offer. Nobody can do anything with it.
--
-- Caught by scratch/audit_transfers_db.js: of 1 open listing, 1 was inert.
-- The blast radius today is a single listing in a test league, but the defect is
-- structural — it would have silently voided every real listing the moment 077
-- ran against a populated board.
--
-- What the old semantics actually were, from TradesClient's ListingCard
-- (pre-revamp): a 'pending' listing showed BOTH "Propose Trade" and "Place Bid".
-- So a legacy listing was open to both, and min_bid was the only number the
-- seller had advertised. That maps cleanly onto the new gates.

-- ── 1. Backfill listings still sitting at the 077 defaults ──
--
-- ask_price := min_bid satisfies both ordering constraints:
--   ask >= min_bid            — equal, holds
--   ask <  buy_now_price      — buy_now > min_bid is already enforced by
--                               player_sale_listings_buy_now_gt_min
-- min_bid = 0 backfills to ask_price = 0, which is the honest reading of what a
-- €0 floor meant: "make me an offer".

UPDATE public.player_sale_listings
SET open_to_trade = TRUE,
    open_to_sale  = TRUE,
    ask_price     = COALESCE(ask_price, min_bid),
    updated_at    = NOW()
WHERE open_to_trade = FALSE
  AND open_to_sale  = FALSE;


-- ── 2. Make an inert listing structurally impossible ────────
--
-- A listing that accepts neither kind of offer is not a listing. Leaving this to
-- the API to enforce is how the gates got skipped in the first place — the
-- FALSE/FALSE default meant any insert that forgot the columns produced a dead
-- row with no error. This is added VALID because step 1 guarantees no violators.

ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_gate_not_inert;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_gate_not_inert
  CHECK (open_to_trade OR open_to_sale);

COMMENT ON CONSTRAINT player_sale_listings_gate_not_inert
  ON public.player_sale_listings IS
  'A listing must entertain at least one kind of offer. Prevents the FALSE/FALSE default from producing a listing nobody can act on.';


-- ============================================================
-- POST-APPLY CHECK — expect inert = 0, and gate_not_inert validated.
-- ============================================================
--
--   SELECT COUNT(*) FILTER (WHERE NOT open_to_trade AND NOT open_to_sale) AS inert,
--          COUNT(*) FILTER (WHERE open_to_trade AND open_to_sale)         AS both,
--          COUNT(*) FILTER (WHERE open_to_sale AND ask_price IS NULL)     AS sale_without_price,
--          COUNT(*)                                                        AS total
--     FROM public.player_sale_listings
--    WHERE status IN ('pending','active');
--
--   SELECT conname, convalidated FROM pg_constraint
--    WHERE conrelid = 'public.player_sale_listings'::regclass
--      AND conname = 'player_sale_listings_gate_not_inert';
