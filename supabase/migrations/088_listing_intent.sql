-- 088 — listing gates become intent
--
-- 077 introduced `open_to_trade` / `open_to_sale` and 083 added `open_to_loan`
-- as GATES: a seller ticked what they would entertain, and the API refused
-- everything else at proposal time. The reasoning was that a seller who never
-- opted into cash offers should not have to read and reject them.
--
-- In practice the gates did something else. They made a listing LESS
-- approachable than not listing at all — anyone may propose a loan for an
-- unlisted player on any roster, but list him without ticking `open_to_loan`
-- and nobody can even ask. Listing a player, the one act that advertises him as
-- available, was quietly removing the ways to reach him.
--
-- So the three booleans stop blocking and start advertising. They say what the
-- seller is AFTER — cash, players, a loan — which sorts the board and sets the
-- headline other managers read ("For sale · €95m", "Wants players", "Open to
-- approaches"). Nobody is refused for asking the wrong way.
--
-- The columns keep their names. Renaming them would touch the RPCs, the RLS
-- policies and every query for no behavioural gain; the COMMENTs below carry
-- the new meaning, in the same spirit as `faab_budget` being surfaced as "Club
-- Balance" everywhere a manager can see it.
--
-- WHAT DOES NOT CHANGE: `min_bid`. A cash offer must still clear it, and the
-- 80%-of-market-value trigger from 077 §3 still sets where it can sit. That
-- floor is not about the seller's taste — it stops the private-offer path being
-- used to buy under a price the seller has already committed to publicly, which
-- would undercut their own auction. Enforcement stays in
-- `POST /api/leagues/[leagueId]/trades`.
--
-- Nor does the `status = 'active'` lock: once bidding is live, nothing is
-- arranged privately around an auction other managers have committed budget to.

-- ── 1. A listing may now state no preference at all ──────────
--
-- 083's constraint required at least one gate, because a listing that refused
-- every approach was inert — it advertised a player nobody could reach. Under
-- intent that is no longer true: all three false now means "no strong
-- preference, make me an offer", which is a perfectly ordinary stance and the
-- most permissive one there is.

ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_gate_not_inert;

-- ── 2. An asking price becomes optional ──────────────────────
--
-- 077 required `ask_price` whenever `open_to_sale` was set, on the grounds that
-- an open_to_sale listing with no number on it is just a shrug. A shrug is now
-- a legitimate position: "I'd take cash, but you tell me what he's worth."
-- The floor still exists (`min_bid`), so an absent ask is not an absent price —
-- it is an absent OPINION about the price.
--
-- `player_sale_listings_gate_order` is deliberately left in place: it is
-- already null-tolerant (`ask_price IS NULL OR ...`), so it constrains the ask
-- only when there is one, which is still what we want.

ALTER TABLE public.player_sale_listings
  DROP CONSTRAINT IF EXISTS player_sale_listings_ask_requires_price;

-- ── 3. Record the new meaning on the columns ─────────────────

COMMENT ON COLUMN public.player_sale_listings.open_to_trade IS
  'INTENT, not a gate: the seller is after players. Advisory only — offers including players are accepted whatever this says. Drives board filtering and the listing headline.';

COMMENT ON COLUMN public.player_sale_listings.open_to_sale IS
  'INTENT, not a gate: the seller is after cash. Advisory only — cash offers are accepted whatever this says, provided they clear min_bid. Does not require ask_price.';

COMMENT ON COLUMN public.player_sale_listings.open_to_loan IS
  'INTENT, not a gate: the seller will consider letting him go out on loan. Advisory only — loan proposals are accepted whatever this says, unless bidding has gone live.';

COMMENT ON COLUMN public.player_sale_listings.ask_price IS
  'Optional advertising. Meeting it sends an offer the seller must still accept; only buy_now_price executes on contact. NULL means the seller has not named a number, not that he is unavailable.';

-- POST-APPLY CHECK — expect zero rows from each.
--
--   -- constraints gone:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.player_sale_listings'::regclass
--      AND conname IN ('player_sale_listings_gate_not_inert',
--                      'player_sale_listings_ask_requires_price');
--
--   -- and the ones that must survive are still there (expect 3 rows):
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.player_sale_listings'::regclass
--      AND conname IN ('player_sale_listings_buy_now_gt_min',
--                      'player_sale_listings_gate_order',
--                      'player_sale_listings_status_check');
