-- Gaffa — Migration 070: snapshot market value when an auction opens
--
-- `waiver_claims` records what a player sold for (`faab_bid`) but nothing about
-- what he was worth at the time. `players.market_value` is overwritten by every
-- Transfermarkt sync, so the reference price is gone within days and cannot be
-- reconstructed afterwards from anything in this database.
--
-- That makes the auction premium — winning bid / market value — permanently
-- unmeasurable after the fact. The premium is the number that calibrates
-- `leagues.departure_compensation_rate` (migration 069): compensation should be
-- judged against what it actually costs to replace a player in this league's
-- market, not against the Transfermarkt sticker. Without this column the first
-- season's data is lost and the rate stays a guess forever.
--
-- Written only on the system anchor row (team_id IS NULL) — the one row created
-- once when an auction opens, as opposed to the managers' bids, which share the
-- same table. One auction, one reference price. Nullable because every row
-- predating this migration has no value to record, and because a player with no
-- Transfermarkt valuation legitimately has none.
--
-- To compute the premium once a season has been played:
--
--   SELECT anchor.player_id,
--          anchor.market_value_at_auction,
--          MAX(bids.faab_bid) AS winning_bid,
--          MAX(bids.faab_bid) / NULLIF(anchor.market_value_at_auction, 0) AS premium
--     FROM public.waiver_claims anchor
--     JOIN public.waiver_claims bids
--       ON bids.league_id = anchor.league_id
--      AND bids.player_id = anchor.player_id
--      AND bids.team_id IS NOT NULL
--    WHERE anchor.team_id IS NULL
--      AND anchor.is_auction = TRUE
--      AND anchor.market_value_at_auction > 0
--    GROUP BY anchor.player_id, anchor.market_value_at_auction;
--
-- Note the two markets are worth reading separately: rows with a
-- `sale_listing_id` are manager-to-manager sales (budget circulates between
-- teams), rows without are system auctions (budget leaves the economy). It is
-- the system-auction premium that governs replacement cost.

ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS market_value_at_auction NUMERIC(10,2);

COMMENT ON COLUMN public.waiver_claims.market_value_at_auction IS
  'players.market_value snapshotted when this auction opened. Set on the system anchor row (team_id IS NULL) only. Exists so the auction premium stays computable after Transfermarkt overwrites the live value — see migration 069.';
