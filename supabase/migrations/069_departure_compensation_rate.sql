-- Gaffa — Migration 069: make departure compensation a per-league dial
--
-- Compensation for a player leaving the Premier League was a hardcoded
-- constant in two places that had silently drifted apart:
--   * src/lib/transfers/compensation.ts  COMPENSATION_RATE = 1.0  (relegation / Kickoff)
--   * src/lib/roster/executeDrop.ts      0.8 inline              (manual transfer-out)
-- so the same event paid a different amount depending on which code path ran.
--
-- The rate is not an implementation detail — it is the central balance dial of
-- the departure economy. It decides whether a manager should ever choose to
-- keep a departed player's rights instead of taking the cash: retaining is only
-- rational when P(player returns to the PL) > rate / auction premium. Set to
-- 1.0 there is no premium high enough to make retention worthwhile, and the
-- Retained List becomes dead content.
--
-- The correct value depends on what auctions actually clear at relative to
-- market value, which cannot be known before the league has played a season
-- (see migration 070, which starts collecting the data needed to compute it).
-- So this ships as league config with a defensible default rather than as a
-- constant someone has to guess correctly today.
--
-- 0.8 is the default because it is what the manual transfer-out path has always
-- paid, and it leaves room for retention to be the right call on a high-
-- probability returnee (a relegated PL regular, a player out on loan abroad)
-- while still making it wrong for a 34-year-old leaving for Saudi Arabia.

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS departure_compensation_rate NUMERIC(4,3) NOT NULL DEFAULT 0.8;

-- Guard the dial. Above 1.0 a departure pays more than the player was ever
-- worth, which turns losing a player into a profit and makes transfer-out
-- strictly better than holding him. Below 0 it would charge for a departure.
ALTER TABLE public.leagues
  DROP CONSTRAINT IF EXISTS leagues_departure_compensation_rate_range;

ALTER TABLE public.leagues
  ADD CONSTRAINT leagues_departure_compensation_rate_range
  CHECK (departure_compensation_rate >= 0 AND departure_compensation_rate <= 1);

COMMENT ON COLUMN public.leagues.departure_compensation_rate IS
  'Fraction of market_value paid to the owner when a player leaves the Premier League. Balance dial for the Retained List: retention is only rational when P(return) > rate / auction premium. Retune from real auction data (see waiver_claims.market_value_at_auction) once a season has been played.';
