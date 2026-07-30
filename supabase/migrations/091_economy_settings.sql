-- ============================================================
-- Migration 091: Economy settings + two default corrections
-- ============================================================
-- Adds per-league rate dials for monthly merit income and transfer
-- recirculation, so the economy can be retuned without a migration.
-- See docs/superpowers/specs/2026-07-29-economy-rebalance-design.md.

-- ── 1. Merit income rates (€m per league match result) ──────
-- Defaults chosen so win + loss = 2 x draw. Every match therefore pays out
-- exactly EUR 3.0m regardless of result, which makes the season's total
-- outlay deterministic. A draw pays less than half a win deliberately: the
-- 10-point draw band exists because a narrow margin is noise, so a coin
-- flip should not pay like a win.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS merit_win  NUMERIC(5,2) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS merit_draw NUMERIC(5,2) NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS merit_loss NUMERIC(5,2) NOT NULL DEFAULT 0.5,
  -- Odd-sized leagues get a virtual BYE (schedule/generator.ts), so a club
  -- can have no fixture in a gameweek. A bye is paid at the draw rate --
  -- it is neither earned nor lost.
  ADD COLUMN IF NOT EXISTS merit_bye  NUMERIC(5,2) NOT NULL DEFAULT 1.5;

-- ── 2. Transfer recirculation ───────────────────────────────
-- solidarity_share: fraction of a burned amount that returns to the league.
-- scout_share: fraction OF THAT POOL paid to the auction initiator.
-- 0.20 x 0.50 means the scout receives 10% of the winning bid, uncapped,
-- and the other non-winning clubs share another 10% equally.
--
-- 0.20 is near the ceiling: after this change free-agent bids are the only
-- remaining sink, so sigma sets the league-wide signing spend needed to
-- break even (EUR 149m/team at 0.20; EUR 178m/team at 0.33, which no
-- realistic season reaches).
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS solidarity_share NUMERIC(4,3) NOT NULL DEFAULT 0.200,
  ADD COLUMN IF NOT EXISTS scout_share      NUMERIC(4,3) NOT NULL DEFAULT 0.500;

-- ── 3. Departure compensation 0.8 -> 0.6 ────────────────────
-- Departure compensation is the second-largest faucet in the system (~EUR
-- 152m/season for a 6-team league at 0.8) and it is money invented rather
-- than recycled. Trading it for recirculation is strictly better economics.
-- It also repairs the Retained List: compensation.ts documents that
-- retaining is rational only when P(return) > rate / auction premium, and
-- at 0.8 the cash is good enough that releasing is almost always correct.
ALTER TABLE public.leagues
  ALTER COLUMN departure_compensation_rate SET DEFAULT 0.6;

-- Bring existing leagues onto the new rate. Safe: no league has yet run a
-- season with human managers, so there is no historical payout to honour.
UPDATE public.leagues SET departure_compensation_rate = 0.6
WHERE departure_compensation_rate = 0.8;

-- ── 4. Fix the teams.faab_budget default ────────────────────
-- Migration 018 set this to 500 while leagues/create/route.ts passes
-- `faabBudget ?? 250`. Any teams row inserted without an explicit value
-- therefore started at double the intended balance.
ALTER TABLE public.teams ALTER COLUMN faab_budget SET DEFAULT 250;
