-- ============================================================
-- Migration 097: Make the 2026-07 prize curve actually take effect
-- ============================================================
-- The economy pass rewrote the payout design in code:
--
--   SEASON_PRIZE_FIRST = 40, SEASON_PRIZE_LAST = 20   (exponential, N-agnostic)
--   DEFAULT_PRIZE_CONFIG = champions 40/15, league 20/8, consolation 20/8
--
-- None of it ever ran. `leagues.prize_config` carries a NOT NULL column default
-- holding the PREVIOUS numbers (season_1st 90 … season_10th 52, champions 60,
-- consolation 60), and both read paths are per-key fallbacks:
--
--   prizeDistribution.ts:119  prizeConfig[key] ?? computeSeasonPrize(rank, n)
--   prizeDistribution.ts:211  prizeConfig[k]   ?? DEFAULT_PRIZE_CONFIG[k] ?? 0
--
-- A key that is present always wins, and the default seeded every key into
-- every row — so the curve and the new cup values were unreachable dead code in
-- all 15 leagues. A 10-team league was set to pay 659m in placement + 215m in
-- cups (874m) against the ~370m the redesign intended: a >2x over-injection,
-- every season, into an economy where money never resets. It also contradicts
-- docs/USER_GUIDE.md §14, which publishes 40m/20m and 40m/20m/20m to players.
--
-- Fix: stop storing the defaults. `prize_config` reverts to what its own
-- comment says it is — a per-league OVERRIDE map — and an empty object means
-- "use the code's curve", which is the behaviour the fallbacks were written for.
--
-- Not a retroactive change: season_standings_archive already records what past
-- seasons paid. This only affects resets from here on.

-- ── 1. New leagues start with no overrides ──────────────────
ALTER TABLE public.leagues
  ALTER COLUMN prize_config SET DEFAULT '{}'::jsonb;

-- ── 2. Clear the seeded defaults from existing rows ─────────
-- Guarded to the exact stale blob so a genuinely customised league is left
-- alone. At time of writing all 15 rows match it byte-for-byte; the guard is
-- for anything created between authoring this and running it.
UPDATE public.leagues
SET prize_config = '{}'::jsonb
WHERE prize_config = '{
  "season_1st": 90, "season_2nd": 80, "season_3rd": 73, "season_4th": 68,
  "season_5th": 64, "season_6th": 62, "season_7th": 59, "season_8th": 57,
  "season_9th": 54, "season_10th": 52,
  "champions_cup_winner": 60, "champions_cup_runner_up": 20,
  "league_cup_winner": 40, "league_cup_runner_up": 10,
  "consolation_cup_winner": 60, "consolation_cup_runner_up": 25
}'::jsonb;

-- ── 3. Verify ───────────────────────────────────────────────
-- Expect: every row '{}' unless deliberately customised.
--   SELECT name, prize_config FROM public.leagues ORDER BY created_at DESC;
--
-- A 10-team league then pays, from src/lib/offseason/prizeDistribution.ts:
--   placement  40 34 30 26 23 20 ... (40 × (20/40)^((rank-1)/9), rounded)
--   cups       champions 40/15, league 20/8, consolation 20/8
