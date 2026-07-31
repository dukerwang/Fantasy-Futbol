-- ============================================================
-- Migration 095: Auction pricing and timing settings
-- ============================================================
-- See docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md

-- ── 1. Free-agent bid floor ─────────────────────────────────
-- Raised from a hardcoded 0.2 in auctions/bid/route.ts to 0.5.
--
-- A manager's sale listing has been floored at 80% of market value by a
-- database trigger since 077_listing_gates.sql, on the reasoning that without
-- a floor "two managers could move a €90m striker for €1m and call it a
-- sale." That logic applies identically to a system auction, which charged
-- 20% — a 4x discount with no design reason, which (a) meant a full window's
-- shopping cost only 22% of a starting balance, and (b) made manager listings
-- nearly unsellable, since nobody pays 80% to a rival when the equivalent
-- free agent costs 20%.
--
-- Not raised to 80%: market value is not fantasy value, and the free-agent
-- pool is systematically where they diverge (backup keepers at big clubs,
-- rotation centre-backs, injured stars). At 80% you would be asked €48m for a
-- €60m squad defender who returns zero, nobody bids, and the pool freezes.
-- 50% leaves the market room to discount a player whose real-world price
-- overstates his fantasy worth.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS free_agent_bid_floor NUMERIC(4,3) NOT NULL DEFAULT 0.500;

-- ── 2. Quiet hours ──────────────────────────────────────────
-- No auction may expire inside this window; an expiry that would land there
-- moves to the window's end.
--
-- Needed because NOTHING in the old timer protected the time of day. The
-- docblock claimed "a 3am bid cannot close at 4am — it must stay open until
-- at least 3pm", but MIN_DURATION is 24h, so a 3am first bid floored at 3am
-- the NEXT day. The ceiling landed at first_bid + 72h (same clock time) and
-- the inactivity close at last_bid + 12h, so a 3pm last bid closed at 3am.
-- Roughly half of all closes already landed overnight.
--
-- auction_timezone is deliberately NULL-defaulted: it must match where the
-- managers live, not where the football is, so there is no safe default.
-- leagueAuctionSettings.ts falls back to 'Europe/London' when it is unset and
-- the league creation form should ask for it.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS auction_quiet_start TIME NOT NULL DEFAULT '00:00',
  ADD COLUMN IF NOT EXISTS auction_quiet_end   TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS auction_timezone    TEXT NULL;

-- ── 3. Staggered release ────────────────────────────────────
-- NULL means "open now", which is every existing row and every auction
-- created by any path other than season kickoff. Kickoff sets future values
-- so the elite tier is released in waves instead of 14-25 simultaneous
-- auctions that nobody has to compete for.
--
-- No scheduler is involved: the bid route rejects a row whose opens_at is in
-- the future, so the wave "opens" simply by time passing. Deliberate —
-- vercel.json does not schedule every /api/cron/* route, so a cron-dependent
-- release could silently never fire.
ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS opens_at TIMESTAMPTZ NULL;

-- Partial index: only the seeded anchor rows ever carry a value.
CREATE INDEX IF NOT EXISTS idx_waiver_claims_opens_at
  ON public.waiver_claims(league_id, opens_at)
  WHERE opens_at IS NOT NULL;
