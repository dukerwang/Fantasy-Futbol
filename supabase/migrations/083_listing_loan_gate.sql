-- Gaffa — Migration 083: the loan gate
--
-- ⚠️ APPLY AFTER 082. This migration re-adds `player_sale_listings_gate_not_inert`
--    with a third disjunct. 082 both backfills the pre-077 rows and adds the
--    two-gate version of that constraint; applying 083 first would add a CHECK
--    that every un-backfilled (inert) listing violates, and the ALTER would fail.
--
-- 077 gave a listing two gates — will the seller entertain player offers
-- (`open_to_trade`), will they entertain cash offers (`open_to_sale`) — on top of
-- the auction, which is mandatory and needs no column because it IS the listing.
--
-- This adds the third: will they entertain a loan.
--
--     offers   (lowest — slowest, seller confirms every deal)
--       ↓
--     auction  (middle — always on, seller loses control once bidding starts)
--       ↓
--     buy now  (highest — instant)
--
--     loan     (orthogonal — not a sale at all; the player comes back)
--
-- A loan is deliberately NOT part of the price ladder. The other three gates all
-- end with the player belonging to someone else permanently, and they order
-- against each other by price. A loan is a different kind of transaction with its
-- own terms (duration, points-bonus rate, bonus cap, recall buyback) that are
-- negotiated in the proposal, not advertised on the listing. So `open_to_loan`
-- carries no price column and takes no part in `player_sale_listings_gate_order`.
--
-- Why put it on the listing at all, then? Because "I would let this player go"
-- is one decision a manager makes once, and the listing is where they record it.
-- Before this, `POST /loans` refused any listed player outright, so listing a
-- player silently withdrew him from the loan market too — an unstated coupling
-- of two independent choices.

-- ── 1. The gate column ───────────────────────────────────────

ALTER TABLE public.player_sale_listings
  ADD COLUMN IF NOT EXISTS open_to_loan BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.player_sale_listings.open_to_loan IS
  'Seller will consider loan proposals for this player. Unlike open_to_trade / open_to_sale this carries no advertised price — loan terms are negotiated in the proposal.';

-- DEFAULT FALSE is the right backfill here, and unlike 077 it is not an
-- oversight. 082 backfills the pre-077 listings to trade+sale because that is
-- what those listings actually meant under the old UI (a 'pending' listing
-- offered both "Propose Trade" and "Place Bid"). No listing has ever meant "open
-- to loan" — the concept did not exist, and `POST /loans` actively refused
-- listed players. Inferring consent to a loan market that never existed would be
-- inventing intent the seller never expressed.

-- ── 2. Widen the inert-listing constraint ────────────────────
--
-- 082 added this as (open_to_trade OR open_to_sale). A listing that accepts only
-- loan proposals is a coherent thing to advertise — "he is not for sale, but I
-- would loan him out" — so it must not read as inert.
--
-- Added VALID: every existing row already satisfies 082's stricter two-gate
-- form, and widening a CHECK can never invalidate a row that passed the narrower
-- one.

ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_gate_not_inert;
ALTER TABLE public.player_sale_listings
  ADD CONSTRAINT player_sale_listings_gate_not_inert
  CHECK (open_to_trade OR open_to_sale OR open_to_loan);

COMMENT ON CONSTRAINT player_sale_listings_gate_not_inert
  ON public.player_sale_listings IS
  'A listing must entertain at least one kind of approach — a player offer, a cash offer, or a loan. Prevents the FALSE/FALSE/FALSE default from producing a listing nobody can act on.';


-- ============================================================
-- WHAT THIS MIGRATION DOES NOT DO — enforced in application code
-- ============================================================
--
-- The gate is only half the rule. `POST /loans` must go from "refuse every
-- listed player" to "refuse when the gate is shut, or when bidding is live", and
-- `POST /loans/[loanId]` (accept) must refuse a player whose listing has since
-- gone to 'active'. That second guard is the load-bearing one:
--
--   1. seller lists a player, open_to_loan, status 'pending'
--   2. a borrower proposes a loan — legal, the listing is quiet
--   3. someone bids; place_auction_bid_rpc flips the listing to 'active'
--   4. the lender accepts the loan
--
-- At step 4 the accept path cancels pending listings only (`.eq('status',
-- 'pending')`), so an 'active' listing survives its own player being loaned out.
-- The resolver would then hand a player who is sitting in a third club's lineup
-- to the auction winner. Today this is unreachable because step 2 is refused
-- outright; relaxing step 2 without guarding step 4 opens it.
--
-- Not enforced in SQL because the two states live in different tables with no
-- foreign key between them, so the check needs a trigger on player_loans that
-- subqueries player_sale_listings — and the accept path already re-validates
-- roster status, budget and loan caps in the route for the sake of readable
-- error messages. One more check there is consistent; a trigger raising a bare
-- exception into that flow is not.


-- ============================================================
-- POST-APPLY CHECK — expect inert = 0 and the constraint validated.
-- ============================================================
--
--   SELECT COUNT(*) FILTER (WHERE NOT open_to_trade AND NOT open_to_sale
--                             AND NOT open_to_loan)                AS inert,
--          COUNT(*) FILTER (WHERE open_to_loan)                    AS loanable,
--          COUNT(*)                                                AS total
--     FROM public.player_sale_listings
--    WHERE status IN ('pending','active');
--
--   SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
--     FROM pg_constraint
--    WHERE conrelid = 'public.player_sale_listings'::regclass
--      AND conname = 'player_sale_listings_gate_not_inert';
--
-- Expect: inert = 0, loanable = 0 (nothing opts in until a seller does),
-- convalidated = true, and the def naming all three gates.
