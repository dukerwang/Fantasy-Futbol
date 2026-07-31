# Transfer Market Pricing & Auction Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a signing cost real money (free-agent floor 20% → 50% of market value), force competition by releasing elite players in waves rather than all at once, and close the auction timer's sniping hole without ever resolving an auction at 4am.

**Architecture:** All auction-close arithmetic moves into pure, exported functions in `src/lib/auction/timer.ts` and is genuinely test-driven — four decay bands, a 24h floor and a timezone-aware quiet-hours guard interact, which is exactly the shape where an untested edge case survives. Everything else is a small change to an existing route or seeding path, gated on new `leagues` columns so the rates are tunable without a migration.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres) via `@supabase/supabase-js`, vitest 4, `Intl.DateTimeFormat` for timezone handling (no date library).

## Global Constraints

- **Source of truth for the design:** `docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md`. Read it before starting. Its companion is `docs/superpowers/specs/2026-07-29-economy-rebalance-design.md`.
- **Ship this after the economy plan** (`docs/superpowers/plans/2026-07-29-economy-rebalance.md`). Tightening prices before the monthly income exists would squeeze the first season. The two plans are otherwise independent and touch different files, with one exception noted in Task 5.
- **Migration numbering:** run `ls supabase/migrations | tail -3` first. If the economy plan's `089`–`092` have landed, this plan is `093`–`094`. If not, use the next two free numbers and adjust every reference.
- **Migrations are applied by hand** in the Supabase SQL editor. A new `.sql` file is *not* live until the user runs it. Never assume one has been applied.
- **`npm run build` must pass before any task is considered done.** No CI exists; the build and the unit tests are the only automated gates.
- **Run tests with `npm test`** (`vitest run`). If `npm test` does not resolve on PATH, use `node node_modules/vitest/vitest.mjs run`. Typecheck with `node node_modules/typescript/bin/tsc --noEmit` — there is no npm script for it.
- **Never call `Date.now()` inside a pure function you want to test.** Every timer function takes explicit timestamps; `Date.now()` belongs only in the route that calls them.
- **User-facing copy never says "FAAB"** — always "Club Balance" (or "budget"), amounts as `€{n}m`.
- **Styling is CSS Modules only.** Reuse existing `--color-*` tokens from `src/app/globals.css`; never hardcode hex. Every visual change must be checked in both themes (Cream Editorial light, Premium Dark).
- **Never key durable data on an FPL team id or fixture id.** See the "Club identity" section of `CLAUDE.md`.

---

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `supabase/migrations/093_auction_pricing_settings.sql` | League rate/quiet-hours columns; `waiver_claims.opens_at`. | Create (Task 1) |
| `src/lib/auction/timer.ts` | All auction-close arithmetic. Pure, no DB, no `Date.now()` in the computation path. | Rewrite (Task 2) |
| `src/lib/auction/__tests__/timer.test.ts` | Unit tests for the above. | Create (Task 2) |
| `src/lib/auction/leagueAuctionSettings.ts` | Reads the quiet-hours + floor settings for one league, with code defaults. | Create (Task 3) |
| `src/app/api/leagues/[leagueId]/auctions/bid/route.ts` | Passes quiet hours to the timer; enforces the 50% floor and the `opens_at` gate. | Modify (Tasks 3, 4, 7) |
| `src/app/api/leagues/[leagueId]/listings/[listingId]/bid/route.ts` | Second timer caller — same quiet-hours wiring. | Modify (Task 3) |
| `src/lib/offseason/seasonKickoff.ts` | Computes staggered `opens_at` waves; single 72h expiry. | Modify (Tasks 5, 6) |
| `src/lib/economy/../auctions/seedHighValueAuctions.ts` → `src/lib/auctions/seedHighValueAuctions.ts` | Single 72h expiry; pre-draft invariant comment. | Modify (Tasks 5, 9) |
| `src/lib/auctions/__tests__/seedingWaves.test.ts` | Wave-partition arithmetic + the pre-draft invariant. | Create (Tasks 6, 9) |
| `src/lib/roster/executeDrop.ts` | Single 72h expiry via `initialAuctionExpiry()`. | Modify (Task 5) |
| `supabase/migrations/094_reauction_expiry_72h.sql` | 062's dropped-player re-auction block → 72h, `opens_at` NULL. | Create (Task 5) |
| `src/app/api/leagues/[leagueId]/auctions/route.ts` | Passes `opens_at` through to the client. | Modify (Task 7) |
| `src/app/(dashboard)/league/[leagueId]/players/page.tsx` | The duplicate list builder — same pass-through. | Modify (Task 7) |
| `src/types/index.ts` | `opens_at` on `AuctionListing`. | Modify (Task 7) |
| `src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx` | "Opens in Xd" state; 50% floor copy. | Modify (Task 8) |
| `docs/USER_GUIDE.md`, `docs/drafts/OPEN_RULES_QUESTIONS.md` | §8 rewrite; items 1 and 2 resolved. | Modify (Task 10) |

**Where the tests live.** `vitest.config.ts` includes `src/**/__tests__/**/*.test.ts`, so new directories under `src/lib/auction/` and `src/lib/auctions/` are picked up with no config change.

**A refinement on the spec.** §3.2 of the design says both auction-list builders need "the `opens_at` filter." Implement it as a **pass-through, not a filter** — an unopened auction must stay *visible* with an "opens in Xd" state so managers can plan budgets across the window (hiding it would recreate the information asymmetry §8 of the guide disclaims). The actual enforcement is a single guard in the bid route. This is simpler than filtering in two places and satisfies the same requirement.

---

## Task 1: Settings columns and `waiver_claims.opens_at`

Foundation. Every later task reads these.

**Files:**
- Create: `supabase/migrations/093_auction_pricing_settings.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `leagues.free_agent_bid_floor NUMERIC(4,3)`, `leagues.auction_quiet_start TIME`, `leagues.auction_quiet_end TIME`, `leagues.auction_timezone TEXT`, `waiver_claims.opens_at TIMESTAMPTZ NULL`.

- [ ] **Step 1: Confirm the migration number**

Run: `ls supabase/migrations | tail -3`
Expected: if `092_solidarity_on_drops_and_buyback.sql` is the head, use `093`. If the head is `088_listing_intent.sql`, the economy plan has not landed — use `089` here and `090` for Task 5, and note the shift.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/093_auction_pricing_settings.sql`:

```sql
-- ============================================================
-- Migration 093: Auction pricing and timing settings
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
```

- [ ] **Step 3: Hand it to the user with a verification query**

Tell the user to run `093_auction_pricing_settings.sql` in the Supabase SQL editor, then:

```sql
SELECT free_agent_bid_floor, auction_quiet_start, auction_quiet_end, auction_timezone
FROM public.leagues;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'waiver_claims' AND column_name = 'opens_at';
```

Expected: `0.500 | 00:00:00 | 08:00:00 | NULL` per league, and `opens_at | timestamp with time zone | YES`.

Also tell them **they must set `auction_timezone`** for their league, since it has no default:

```sql
UPDATE public.leagues SET auction_timezone = 'America/New_York'; -- or wherever the managers are
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build completes. (SQL-only change, but this is the gate.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/093_auction_pricing_settings.sql
git commit -m "feat(auctions): add bid floor, quiet hours and staggered-release columns"
```

---

## Task 2: Rewrite the auction timer

The core task. Pure functions, fully test-driven.

**Files:**
- Modify: `src/lib/auction/timer.ts` (full rewrite)
- Create: `src/lib/auction/__tests__/timer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface QuietHours { start: string; end: string; timeZone: string }`
  - `DEFAULT_QUIET_HOURS: QuietHours`
  - `MIN_DURATION_MS: number`, `INITIAL_WINDOW_MS: number`
  - `inactivityTimeoutMs(ageMs: number): number`
  - `applyQuietHours(timestampMs: number, quiet: QuietHours | null): number`
  - `calculateExpiresAt(firstBidTime: number, lastBidTime: number, quiet?: QuietHours | null): string`
  - `initialAuctionExpiry(now: number, quiet?: QuietHours | null): string`
  - **Removed:** `MAX_DURATION_STD_MS`, `MAX_DURATION_BIG_MS`, `BIG_TRANSFER_THRESHOLD`, and the `isBigTransfer` parameter on both exported functions.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auction/__tests__/timer.test.ts`:

```ts
/**
 * Gaffa — auction close timing
 *
 * Three properties must hold simultaneously, and the old min()-against-a-wall
 * formula could not hold them together:
 *
 *   1. No timeable instant. Every bid must push the close out by something, or
 *      a contested auction becomes a public deadline that can be sniped.
 *   2. Bounded in practice. A contested auction must converge rather than run
 *      forever.
 *   3. No overnight resolution. An auction must never close while the league is
 *      asleep, whatever the formula produces.
 */

import { describe, it, expect } from 'vitest';
import {
    MIN_DURATION_MS,
    INITIAL_WINDOW_MS,
    DEFAULT_QUIET_HOURS,
    inactivityTimeoutMs,
    applyQuietHours,
    calculateExpiresAt,
    initialAuctionExpiry,
} from '../timer';
import type { QuietHours } from '../timer';

const H = 60 * 60 * 1000;

// A fixed, DST-free reference point: Wed 2026-02-11 12:00:00 UTC.
const T0 = Date.parse('2026-02-11T12:00:00.000Z');

// Quiet hours in UTC keep the tests readable — the timezone path is exercised
// separately below.
const UTC_QUIET: QuietHours = { start: '00:00', end: '08:00', timeZone: 'UTC' };

describe('inactivityTimeoutMs', () => {
    it('decays across the four bands', () => {
        expect(inactivityTimeoutMs(0)).toBe(12 * H);
        expect(inactivityTimeoutMs(47 * H)).toBe(12 * H);
        expect(inactivityTimeoutMs(48 * H)).toBe(4 * H);
        expect(inactivityTimeoutMs(71 * H)).toBe(4 * H);
        expect(inactivityTimeoutMs(72 * H)).toBe(2 * H);
        expect(inactivityTimeoutMs(95 * H)).toBe(2 * H);
        expect(inactivityTimeoutMs(96 * H)).toBe(1 * H);
        expect(inactivityTimeoutMs(1000 * H)).toBe(1 * H);
    });

    it('never returns zero, so no bid can leave the close unmoved', () => {
        for (const age of [0, 1, 47.9, 48, 72, 96, 500, 10000]) {
            expect(inactivityTimeoutMs(age * H)).toBeGreaterThan(0);
        }
    });

    it('is monotonically non-increasing, so an auction always converges', () => {
        let prev = Infinity;
        for (let age = 0; age <= 200 * H; age += H) {
            const t = inactivityTimeoutMs(age);
            expect(t).toBeLessThanOrEqual(prev);
            prev = t;
        }
    });

    it('treats a negative age as a fresh auction rather than throwing', () => {
        expect(inactivityTimeoutMs(-5 * H)).toBe(12 * H);
    });
});

describe('applyQuietHours', () => {
    const at = (iso: string) => Date.parse(iso);

    it('leaves a daytime expiry untouched', () => {
        const t = at('2026-02-11T14:30:00.000Z');
        expect(applyQuietHours(t, UTC_QUIET)).toBe(t);
    });

    it('pushes a 4am expiry to 8am the same day', () => {
        expect(applyQuietHours(at('2026-02-11T04:00:00.000Z'), UTC_QUIET))
            .toBe(at('2026-02-11T08:00:00.000Z'));
    });

    it('pushes a midnight expiry to 8am', () => {
        expect(applyQuietHours(at('2026-02-11T00:00:00.000Z'), UTC_QUIET))
            .toBe(at('2026-02-11T08:00:00.000Z'));
    });

    it('treats the window end as already awake', () => {
        const t = at('2026-02-11T08:00:00.000Z');
        expect(applyQuietHours(t, UTC_QUIET)).toBe(t);
    });

    it('handles a window that wraps midnight', () => {
        const wrap: QuietHours = { start: '22:00', end: '06:00', timeZone: 'UTC' };
        expect(applyQuietHours(at('2026-02-11T23:00:00.000Z'), wrap))
            .toBe(at('2026-02-12T06:00:00.000Z'));
        expect(applyQuietHours(at('2026-02-11T02:00:00.000Z'), wrap))
            .toBe(at('2026-02-11T06:00:00.000Z'));
        const awake = at('2026-02-11T12:00:00.000Z');
        expect(applyQuietHours(awake, wrap)).toBe(awake);
    });

    it('respects a non-UTC timezone', () => {
        // 04:00 New York on 2026-02-11 is 09:00 UTC. Quiet hours are local, so
        // this must be pushed to 08:00 New York = 13:00 UTC.
        const ny: QuietHours = { start: '00:00', end: '08:00', timeZone: 'America/New_York' };
        expect(applyQuietHours(at('2026-02-11T09:00:00.000Z'), ny))
            .toBe(at('2026-02-11T13:00:00.000Z'));
        // 09:00 UTC is 04:00 NY (quiet) but 10:00 London (awake).
        const lon: QuietHours = { start: '00:00', end: '08:00', timeZone: 'Europe/London' };
        const t = at('2026-02-11T09:00:00.000Z');
        expect(applyQuietHours(t, lon)).toBe(t);
    });

    it('is a no-op when quiet hours are disabled', () => {
        const t = at('2026-02-11T04:00:00.000Z');
        expect(applyQuietHours(t, null)).toBe(t);
    });

    it('is a no-op when start equals end (a zero-length window)', () => {
        const none: QuietHours = { start: '08:00', end: '08:00', timeZone: 'UTC' };
        const t = at('2026-02-11T04:00:00.000Z');
        expect(applyQuietHours(t, none)).toBe(t);
    });

    it('always returns a time outside the window, for every hour of the day', () => {
        for (let h = 0; h < 24; h++) {
            const t = at(`2026-02-11T${String(h).padStart(2, '0')}:30:00.000Z`);
            const out = applyQuietHours(t, UTC_QUIET);
            const hour = new Date(out).getUTCHours();
            expect(hour).toBeGreaterThanOrEqual(8);
            expect(out).toBeGreaterThanOrEqual(t);
        }
    });
});

describe('calculateExpiresAt', () => {
    it('honours the 24h floor on a fresh auction', () => {
        // First bid and last bid the same instant: 12h timeout would give T0+12h,
        // but the floor is T0+24h.
        const out = Date.parse(calculateExpiresAt(T0, T0, null));
        expect(out).toBe(T0 + MIN_DURATION_MS);
    });

    it('closes one timeout after the last bid once past the floor', () => {
        const first = T0;
        const last = T0 + 30 * H; // past the 24h floor, age 30h -> 12h timeout
        expect(Date.parse(calculateExpiresAt(first, last, null))).toBe(last + 12 * H);
    });

    it('uses the decayed timeout deep into a contested auction', () => {
        const first = T0;
        for (const [ageH, timeoutH] of [[50, 4], [80, 2], [120, 1]] as const) {
            const last = first + ageH * H;
            expect(Date.parse(calculateExpiresAt(first, last, null)))
                .toBe(last + timeoutH * H);
        }
    });

    // The property the old formula lost: past the ceiling, expires_at froze and
    // no bid could move it, so the final 12h became a snipeable public deadline.
    it('never freezes — a later bid always yields a later close', () => {
        const first = T0;
        let prev = 0;
        for (let ageH = 0; ageH <= 240; ageH += 1) {
            const out = Date.parse(calculateExpiresAt(first, first + ageH * H, null));
            expect(out).toBeGreaterThan(prev);
            prev = out;
        }
    });

    it('never returns a close inside quiet hours', () => {
        const first = T0;
        for (let ageM = 0; ageM <= 200 * 60; ageM += 37) {
            const out = Date.parse(calculateExpiresAt(first, first + ageM * 60000, UTC_QUIET));
            expect(new Date(out).getUTCHours()).toBeGreaterThanOrEqual(8);
        }
    });

    it('always closes at or after the last bid', () => {
        const first = T0;
        for (const ageH of [0, 10, 24, 48, 72, 96, 150]) {
            const last = first + ageH * H;
            expect(Date.parse(calculateExpiresAt(first, last, UTC_QUIET)))
                .toBeGreaterThan(last);
        }
    });

    it('returns an ISO 8601 string', () => {
        expect(calculateExpiresAt(T0, T0, null)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    });
});

describe('initialAuctionExpiry', () => {
    it('opens a single 72h window regardless of market value', () => {
        expect(Date.parse(initialAuctionExpiry(T0, null))).toBe(T0 + INITIAL_WINDOW_MS);
        expect(INITIAL_WINDOW_MS).toBe(72 * H);
    });

    it('respects quiet hours', () => {
        // T0 + 72h = 2026-02-14T12:00Z, already awake.
        expect(Date.parse(initialAuctionExpiry(T0, UTC_QUIET))).toBe(T0 + 72 * H);
        // A 22:00 start lands at 22:00 three days later -> pushed to 08:00.
        const late = Date.parse('2026-02-11T22:00:00.000Z');
        const out = Date.parse(initialAuctionExpiry(late, UTC_QUIET));
        expect(new Date(out).getUTCHours()).toBe(8);
    });
});

describe('DEFAULT_QUIET_HOURS', () => {
    it('is midnight to 8am', () => {
        expect(DEFAULT_QUIET_HOURS.start).toBe('00:00');
        expect(DEFAULT_QUIET_HOURS.end).toBe('08:00');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test src/lib/auction`
Expected: FAIL — `inactivityTimeoutMs`, `applyQuietHours`, `INITIAL_WINDOW_MS` and `DEFAULT_QUIET_HOURS` are not exported.

- [ ] **Step 3: Rewrite the timer**

Replace the entire contents of `src/lib/auction/timer.ts` with:

```ts
/**
 * Gaffa — Activity-Based Auction Timer
 *
 * expires_at = quietHoursGuard( max(first + 24h, last + timeout(age)) )
 *
 * There is no hard ceiling. The previous formula was
 *
 *   min(first + MAX, max(first + 24h, last + 12h))
 *
 * and the min() against a fixed wall made the anti-snipe property conditional:
 * while last + 12h sat below the ceiling every bid pushed the close out, but
 * once it crossed, expires_at FROZE and no further bid moved it — so the final
 * 12 hours became a hard, publicly visible deadline. The auctions that reach a
 * ceiling are the contested ones, so the protection failed exactly where it was
 * needed, and the "Closing inside the hour" facet handed snipers the list.
 *
 * Instead the inactivity timeout decays. Duration is bounded in practice rather
 * than by a wall: sustaining an auction past 96 hours needs a bid every hour,
 * and 079_unified_bid_rpc.sql rejects any bid that does not STRICTLY exceed the
 * current high — so the price climbs monotonically and the auction ends when
 * someone stops paying, which is the correct termination condition for an
 * auction rather than an arbitrary clock.
 *
 * The quiet-hours guard is separate and non-negotiable. Nothing in the old
 * formula protected the time of day: its docblock claimed "a 3am bid cannot
 * close at 4am — it must stay open until at least 3pm", but MIN_DURATION is 24h,
 * so a 3am first bid floored at 3am the NEXT day. The ceiling landed at
 * first + 72h (same clock time) and the inactivity close at last + 12h, so a 3pm
 * last bid closed at 3am. Roughly half of all closes landed overnight.
 *
 * What this guarantees:
 * - Every auction stays open at least MIN_DURATION after the first real bid.
 * - Every bid moves the close later. There is no timeable instant.
 * - No auction resolves inside the league's quiet window.
 *
 * Design doc: docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md
 */

export const MIN_DURATION_MS = 24 * 60 * 60 * 1000; // 24h floor after the first bid

/**
 * How long a seeded auction sits before anyone bids. One value for every
 * seeding path — previously five places stamped this field with three different
 * durations (48h in seedHighValueAuctions, 96h in seasonKickoff, 72/96h here,
 * 48/96h in executeDrop and again in the 062 resolver), so whichever path
 * created the auction silently decided how long it lasted.
 */
export const INITIAL_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Inactivity timeout by auction age. Shrinking rather than capped: this is what
 * replaces the hard ceiling.
 */
const DECAY_BANDS: readonly { readonly untilAgeMs: number; readonly timeoutMs: number }[] = [
    { untilAgeMs: 48 * 60 * 60 * 1000, timeoutMs: 12 * 60 * 60 * 1000 },
    { untilAgeMs: 72 * 60 * 60 * 1000, timeoutMs: 4 * 60 * 60 * 1000 },
    { untilAgeMs: 96 * 60 * 60 * 1000, timeoutMs: 2 * 60 * 60 * 1000 },
    { untilAgeMs: Infinity, timeoutMs: 1 * 60 * 60 * 1000 },
];

export interface QuietHours {
    /** 'HH:MM' local wall-clock time the window opens. */
    start: string;
    /** 'HH:MM' local wall-clock time the window closes. */
    end: string;
    /** IANA zone, e.g. 'America/New_York'. Must match where the managers live. */
    timeZone: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
    start: '00:00',
    end: '08:00',
    timeZone: 'Europe/London',
};

/**
 * The inactivity timeout for an auction of the given age.
 * Never zero — a zero timeout would reintroduce a timeable instant.
 */
export function inactivityTimeoutMs(ageMs: number): number {
    const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
    for (const band of DECAY_BANDS) {
        if (age < band.untilAgeMs) return band.timeoutMs;
    }
    // Unreachable: the last band is Infinity. Kept so the function is total.
    return DECAY_BANDS[DECAY_BANDS.length - 1].timeoutMs;
}

/** Minutes since local midnight, in the given zone, for an absolute instant. */
function localMinutesOfDay(timestampMs: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(timestampMs));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    // Intl can render midnight as 24 in some locales/zones; normalise.
    return (hour % 24) * 60 + minute;
}

function parseHHMM(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Move a timestamp out of the quiet window, forward to the window's end.
 * Handles a window that wraps midnight (e.g. 22:00–06:00).
 *
 * DST safety: advancing by a wall-clock delta can land back inside the window
 * if a transition occurs in between, so the result is re-checked. Bounded at
 * three passes, which is more than any real transition needs.
 */
export function applyQuietHours(timestampMs: number, quiet: QuietHours | null): number {
    if (!quiet) return timestampMs;

    const startMin = parseHHMM(quiet.start);
    const endMin = parseHHMM(quiet.end);
    if (startMin === endMin) return timestampMs; // zero-length window

    const wraps = startMin > endMin;
    const inWindow = (minutes: number) =>
        wraps ? minutes >= startMin || minutes < endMin : minutes >= startMin && minutes < endMin;

    let result = timestampMs;
    for (let pass = 0; pass < 3; pass++) {
        const minutes = localMinutesOfDay(result, quiet.timeZone);
        if (!inWindow(minutes)) return result;
        // Minutes forward to the window's end, wrapping across midnight.
        const delta = (endMin - minutes + 1440) % 1440;
        result += (delta === 0 ? 1440 : delta) * 60_000;
    }
    return result;
}

/**
 * When an auction should close, given its bidding activity.
 *
 * @param firstBidTime Unix ms of the first real (non-system-seed) bid.
 * @param lastBidTime  Unix ms of the most recent bid — pass the current bid's time.
 * @param quiet        League quiet hours, or null to disable the guard.
 */
export function calculateExpiresAt(
    firstBidTime: number,
    lastBidTime: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
): string {
    const age = lastBidTime - firstBidTime;
    const inactivityEnd = lastBidTime + inactivityTimeoutMs(age);
    const minClose = firstBidTime + MIN_DURATION_MS;
    return new Date(applyQuietHours(Math.max(minClose, inactivityEnd), quiet)).toISOString();
}

/**
 * The initial expires_at for a newly seeded auction with no bids yet. The bid
 * route overwrites it via calculateExpiresAt when the first real bid arrives.
 *
 * @param now   Unix ms. Passed in rather than read from Date.now() so this is testable.
 * @param quiet League quiet hours, or null to disable the guard.
 */
export function initialAuctionExpiry(
    now: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
): string {
    return new Date(applyQuietHours(now + INITIAL_WINDOW_MS, quiet)).toISOString();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test src/lib/auction`
Expected: PASS — all tests green.

- [ ] **Step 5: Confirm the removed exports have no orphaned callers**

Run: `grep -rn "MAX_DURATION_STD_MS\|MAX_DURATION_BIG_MS\|BIG_TRANSFER_THRESHOLD" src/`
Expected: hits only in `auctions/bid/route.ts` and `listings/[listingId]/bid/route.ts`. Those are fixed in Task 3 — **the build will fail until then**, which is intended and is why Task 3 follows immediately.

- [ ] **Step 6: Commit (build not yet green)**

```bash
git add src/lib/auction/timer.ts src/lib/auction/__tests__/timer.test.ts
git commit -m "feat(auctions): decaying inactivity timeout with quiet-hours guard, no hard ceiling"
```

Note in the commit body that the two bid routes are updated in the next commit; this one intentionally leaves the build red.

---

## Task 3: Wire the timer into both bid routes

**Files:**
- Create: `src/lib/auction/leagueAuctionSettings.ts`
- Modify: `src/app/api/leagues/[leagueId]/auctions/bid/route.ts:7-8, 290-293`
- Modify: `src/app/api/leagues/[leagueId]/listings/[listingId]/bid/route.ts:27, 108-110`

**Interfaces:**
- Consumes: `QuietHours`, `calculateExpiresAt` from Task 2; the columns from Task 1.
- Produces: `getLeagueAuctionSettings(admin: SupabaseClient, leagueId: string): Promise<{ quietHours: QuietHours | null; bidFloor: number }>`.

- [ ] **Step 1: Write the settings reader**

Create `src/lib/auction/leagueAuctionSettings.ts`:

```ts
/**
 * Gaffa — per-league auction settings
 *
 * One read for both bid routes, so the free-agent floor and the quiet-hours
 * window can never diverge between the free-agent path and the sale-listing
 * path. They previously did diverge on expiry duration, in five places.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_QUIET_HOURS } from './timer';
import type { QuietHours } from './timer';

/** Matches leagues.free_agent_bid_floor's default in migration 093. */
export const DEFAULT_BID_FLOOR = 0.5;

export interface LeagueAuctionSettings {
    /** null disables the guard entirely — only when a league sets a zero-length window. */
    quietHours: QuietHours | null;
    /** Fraction of market value a free-agent bid must at least reach. */
    bidFloor: number;
}

export async function getLeagueAuctionSettings(
    admin: SupabaseClient,
    leagueId: string,
): Promise<LeagueAuctionSettings> {
    const { data } = await admin
        .from('leagues')
        .select('free_agent_bid_floor, auction_quiet_start, auction_quiet_end, auction_timezone')
        .eq('id', leagueId)
        .single();

    const floorRaw = Number(data?.free_agent_bid_floor);
    const bidFloor = Number.isFinite(floorRaw) && floorRaw > 0 ? floorRaw : DEFAULT_BID_FLOOR;

    // Postgres TIME renders as 'HH:MM:SS'; the timer wants 'HH:MM'.
    const trim = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
    const start = trim(data?.auction_quiet_start as string | null) ?? DEFAULT_QUIET_HOURS.start;
    const end = trim(data?.auction_quiet_end as string | null) ?? DEFAULT_QUIET_HOURS.end;

    // auction_timezone has no DB default because there is no safe one — it must
    // match where the managers live. Fall back rather than skip the guard: an
    // approximately-right window still prevents a 4am close.
    const timeZone = (data?.auction_timezone as string | null) || DEFAULT_QUIET_HOURS.timeZone;

    return {
        bidFloor,
        quietHours: start === end ? null : { start, end, timeZone },
    };
}
```

- [ ] **Step 2: Update the free-agent bid route**

In `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`, change the timer import (lines 7–8) from:

```ts
  BIG_TRANSFER_THRESHOLD,
  calculateExpiresAt,
```

to:

```ts
  calculateExpiresAt,
```

Add alongside the other imports:

```ts
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
```

Then replace the expiry calculation at lines 290–293:

```ts
  const now = Date.now();
  const isBigTransfer = playerData && Number(playerData.market_value || 0) >= BIG_TRANSFER_THRESHOLD;
  const firstBidTime = systemSeedClaim?.first_bid_at ? new Date(systemSeedClaim.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, !!isBigTransfer);
```

with:

```ts
  const now = Date.now();
  // Market value no longer affects duration: deleting the hard ceiling removed
  // the only two places the big-transfer distinction fed (72h vs 96h ceiling,
  // 48h vs 96h initial window). Every auction now runs on the same decaying
  // timeout and a single 72h pre-first-bid window.
  const firstBidTime = systemSeedClaim?.first_bid_at ? new Date(systemSeedClaim.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, auctionSettings.quietHours);
```

`auctionSettings` must be fetched earlier in the handler, before the floor check that Task 4 adds. Insert this immediately after `myTeam` is resolved (it is needed by both this and Task 4):

```ts
  const auctionSettings = await getLeagueAuctionSettings(admin, leagueId);
```

- [ ] **Step 3: Update the sale-listing bid route**

In `src/app/api/leagues/[leagueId]/listings/[listingId]/bid/route.ts`, change line 27 from:

```ts
import { BIG_TRANSFER_THRESHOLD, calculateExpiresAt } from '@/lib/auction/timer';
```

to:

```ts
import { calculateExpiresAt } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
```

Then replace lines 108–110:

```ts
  const now = Date.now();
  const isBig = Number(playerData?.market_value || 0) >= BIG_TRANSFER_THRESHOLD;
  const firstBidTime = anchor?.first_bid_at ? new Date(anchor.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, isBig);
```

with:

```ts
  const now = Date.now();
  // Sale listings share the timer with free agents, so the decaying timeout and
  // the quiet-hours guard apply to them too. That is intended.
  const { quietHours } = await getLeagueAuctionSettings(admin, leagueId);
  const firstBidTime = anchor?.first_bid_at ? new Date(anchor.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, quietHours);
```

- [ ] **Step 4: Never leave a new league with a NULL timezone**

Migration 093 gives `auction_timezone` no default, because there is no safe one — it must match where the managers live. But a NULL means every league silently falls back to `Europe/London`, so the setting exists and nobody is ever asked for it.

In `src/app/api/leagues/create/route.ts`, accept it from the request body and write it explicitly. Change the destructure at line 13:

```ts
  const { name, teamName, maxTeams, rosterSize, faabBudget, draftType, isDynasty } = await req.json();
```

to:

```ts
  const { name, teamName, maxTeams, rosterSize, faabBudget, draftType, isDynasty, auctionTimezone } = await req.json();
```

and add to the `leagues` insert object, after `is_dynasty`:

```ts
    // Quiet hours are meaningless without a zone, and the column has no default
    // because the right value depends on where the managers live. Resolve it here
    // so no league is ever created NULL and silently inherits Europe/London.
    auction_timezone: auctionTimezone
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || 'Europe/London',
```

`Intl.DateTimeFormat().resolvedOptions().timeZone` resolves to the *server's* zone, which is a better guess than a hardcoded one and is overridden the moment the creation form passes a value. Adding that form field is a follow-up, not part of this plan — note it for the user rather than expanding scope here.

- [ ] **Step 5: Confirm no orphaned references remain**

Run: `grep -rn "BIG_TRANSFER_THRESHOLD\|isBigTransfer\|isBig\b" src/app/api/leagues/`
Expected: no output. Any hit is a dead binding — delete it rather than suppressing a lint warning.

- [ ] **Step 6: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes. The build is green again from here.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auction/leagueAuctionSettings.ts \
        "src/app/api/leagues/[leagueId]/auctions/bid/route.ts" \
        "src/app/api/leagues/[leagueId]/listings/[listingId]/bid/route.ts" \
        src/app/api/leagues/create/route.ts
git commit -m "feat(auctions): wire quiet hours into both bid routes, drop dead isBigTransfer"
```

---

## Task 4: Raise the free-agent bid floor to 50%

**Files:**
- Modify: `src/app/api/leagues/[leagueId]/auctions/bid/route.ts:186-195`

**Interfaces:**
- Consumes: `auctionSettings.bidFloor` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Replace the hardcoded 20%**

In `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`, replace the free-agent branch of the floor check:

```ts
  } else {
    // Free agent: the Transfermarkt floor of 20% of market value.
    const minimumBid = playerData ? Math.floor(Number(playerData.market_value || 0) * 0.2) : 0;
    if (minimumBid > 0 && bidAmount < minimumBid) {
      return NextResponse.json(
        { error: `Minimum bid for this player is €${minimumBid}m (20% of Transfermarkt value)` },
        { status: 400 },
      );
    }
  }
```

with:

```ts
  } else {
    // Free agent: a floor as a share of market value, per league setting
    // (default 50% — migration 093).
    //
    // This was a hardcoded 20% while a MANAGER's listing has been floored at
    // 80% by a DB trigger since 077_listing_gates.sql. Same player, four times
    // the price depending on who was selling. The consequences were that a full
    // window's shopping cost only 22% of a starting balance, and that manager
    // listings were nearly unsellable — nobody pays 80% to a rival when the
    // equivalent free agent costs 20%.
    const floorPct = auctionSettings.bidFloor;
    const minimumBid = playerData
      ? Math.floor(Number(playerData.market_value || 0) * floorPct)
      : 0;
    if (minimumBid > 0 && bidAmount < minimumBid) {
      return NextResponse.json(
        {
          error: `Minimum bid for this player is €${minimumBid}m (${Math.round(floorPct * 100)}% of market value)`,
        },
        { status: 400 },
      );
    }
  }
```

Note the copy change: "Transfermarkt value" becomes "market value", which is what the rest of the UI calls it.

- [ ] **Step 2: Confirm `auctionSettings` is in scope**

Run: `grep -n "getLeagueAuctionSettings\|const auctionSettings" "src/app/api/leagues/[leagueId]/auctions/bid/route.ts"`
Expected: the `const auctionSettings = await getLeagueAuctionSettings(...)` line from Task 3 appears *before* the floor check. If it does not, move it earlier — it must precede both the floor check and the expiry calculation.

- [ ] **Step 3: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/leagues/[leagueId]/auctions/bid/route.ts"
git commit -m "feat(transfers): free-agent bid floor 20% -> 50% of market value, as a league setting"
```

---

## Task 5: One initial expiry value everywhere

Five paths stamp `expires_at` on a bid-less auction with three different durations. Collapse all of them onto `initialAuctionExpiry()`.

**Files:**
- Modify: `src/lib/auctions/seedHighValueAuctions.ts:26, 61`
- Modify: `src/lib/offseason/seasonKickoff.ts:26, 260-261`
- Modify: `src/lib/roster/executeDrop.ts` (the `durationHours` block)
- Create: `supabase/migrations/094_reauction_expiry_72h.sql`

**Interfaces:**
- Consumes: `initialAuctionExpiry`, `INITIAL_WINDOW_MS` from Task 2; `getLeagueAuctionSettings` from Task 3.
- Produces: no new exports.

> **Coordination note:** this task rewrites `resolve_single_player_auction_rpc`, which the economy plan's Task 7 (migration 091) also rewrites. **If the economy plan has landed, copy from `091_solidarity_on_auctions.sql`, not from `062`.** Otherwise the solidarity block is silently reverted.

- [ ] **Step 1: Fix the mid-season sweep**

In `src/lib/auctions/seedHighValueAuctions.ts`, delete line 26:

```ts
const AUCTION_WINDOW_HOURS = 48;
```

Add to the imports:

```ts
import { initialAuctionExpiry } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
```

Replace line 61:

```ts
      const expiresAt = new Date(Date.now() + AUCTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
```

with:

```ts
      // One window for every seeding path — see initialAuctionExpiry's docblock
      // for the five places that previously disagreed.
      const { quietHours } = await getLeagueAuctionSettings(admin, league.id);
      const expiresAt = initialAuctionExpiry(Date.now(), quietHours);
```

- [ ] **Step 2: Fix season kickoff**

In `src/lib/offseason/seasonKickoff.ts`, delete line 26:

```ts
const AUCTION_WINDOW_HOURS = 96;
```

Add to the imports:

```ts
import { initialAuctionExpiry } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
```

Replace lines 260–261:

```ts
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + AUCTION_WINDOW_HOURS);
```

with:

```ts
    const { quietHours } = await getLeagueAuctionSettings(admin, leagueId);
    const expiresAt = new Date(initialAuctionExpiry(Date.now(), quietHours));
```

Leave the `expiresAt.toISOString()` in the insert object as-is — it still works on a `Date`. **Task 6 replaces this whole block**, so keep the change minimal here.

- [ ] **Step 3: Fix the standalone drop path**

In `src/lib/roster/executeDrop.ts`, replace:

```ts
        const isBigTransfer = marketValue >= AUCTION_THRESHOLD;
        const durationHours = isBigTransfer ? 96 : 48;
        const auctionExpiry = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
```

with:

```ts
        // Single 72h pre-first-bid window. This path used AUCTION_THRESHOLD (50)
        // to pick between 96h and 48h while the timer and the resolver used 40
        // for the same decision — market value no longer affects duration at all.
        const { quietHours } = await getLeagueAuctionSettings(admin, team.league_id);
        const auctionExpiry = initialAuctionExpiry(Date.now(), quietHours);
```

Add the two imports, and check whether `AUCTION_THRESHOLD` is still used elsewhere in the file:

Run: `grep -n "AUCTION_THRESHOLD" src/lib/roster/executeDrop.ts`
If there are no remaining uses, remove it from the import list. Do **not** delete the constant from `seasonKickoff.ts` — it still decides which players get seeded at all (`seasonKickoff.ts:153`) and is the elite tier for Task 6.

- [ ] **Step 4: Write the resolver migration**

The resolver re-auctions a dropped player with its own 48/96h logic. Create `supabase/migrations/094_reauction_expiry_72h.sql` by copying the **current** resolver — `091_solidarity_on_auctions.sql` if the economy plan has landed, otherwise `062_severance_rate_update.sql` — and making these edits:

Replace the header comment with:

```sql
-- ============================================================
-- Migration 094: One 72h window for the dropped-player re-auction
-- ============================================================
-- The resolver stamped its own 48h/96h expiry on the auction it opens for a
-- dropped player, using a 40 threshold, while executeDrop.ts used 48h/96h with
-- a 50 threshold and seedHighValueAuctions used a flat 48h. Deleting the timer's
-- hard ceiling removed the reason for any of it: every auction now runs a single
-- 72h pre-first-bid window and then a decaying inactivity timeout.
--
-- opens_at is set NULL explicitly: a re-auctioned drop opens immediately. Only
-- season kickoff staggers releases.
```

Then delete these lines from the body:

```sql
      IF v_is_big_transfer THEN
        v_auction_expiry := NOW() + INTERVAL '96 hours';
      ELSE
        v_auction_expiry := NOW() + INTERVAL '48 hours';
      END IF;
```

and replace with:

```sql
      v_auction_expiry := NOW() + INTERVAL '72 hours';
```

Add `opens_at` to that same `INSERT INTO public.waiver_claims`, in both the column list and the values list:

```sql
      INSERT INTO public.waiver_claims (
        league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction, expires_at, opens_at
      ) VALUES (
        p_league_id, NULL, v_winner_claim.drop_player_id, 0, 999, 'pending', 0, TRUE, v_auction_expiry, NULL
      );
```

Finally check whether `v_is_big_transfer` still has a reader:

Run: `grep -n "v_is_big_transfer" supabase/migrations/094_reauction_expiry_72h.sql`
If the only remaining line is its assignment, delete both the `DECLARE` entry and the assignment. Preserve the `REVOKE EXECUTE` line and its `(uuid, uuid, int[])` signature unchanged.

- [ ] **Step 5: Verify no duration literals survive**

Run: `grep -rn "AUCTION_WINDOW_HOURS\|48 \* 60 \* 60\|96 \* 60 \* 60" src/lib/`
Expected: no output.

Run: `grep -n "INTERVAL '48 hours'\|INTERVAL '96 hours'" supabase/migrations/094_reauction_expiry_72h.sql`
Expected: no output.

- [ ] **Step 6: Typecheck, test and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm test && npm run build`
Expected: no typecheck output, tests PASS, build completes.

- [ ] **Step 7: Hand the migration to the user**

Tell the user to run `094_reauction_expiry_72h.sql`, then confirm the function still exists and is not publicly executable:

```sql
SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'resolve_single_player_auction_rpc';
```

Expected: one row, `authenticated_can_run` = `false`.

**Also tell them explicitly whether this migration was copied from `091` or from `062`**, so they know whether the solidarity logic is preserved.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auctions/seedHighValueAuctions.ts src/lib/offseason/seasonKickoff.ts \
        src/lib/roster/executeDrop.ts supabase/migrations/094_reauction_expiry_72h.sql
git commit -m "refactor(auctions): collapse five initial-expiry values into one 72h window"
```

---

## Task 6: Staggered kickoff seeding

**Files:**
- Create: `src/lib/auctions/seedingWaves.ts`
- Create: `src/lib/auctions/__tests__/seedingWaves.test.ts`
- Modify: `src/lib/offseason/seasonKickoff.ts:258-278`

**Interfaces:**
- Consumes: `AUCTION_THRESHOLD` from `seasonKickoff.ts:25`.
- Produces:
  - `WAVE_INTERVAL_MS: number` (3 days)
  - `waveSizeForLeague(teamCount: number): number`
  - `assignReleaseWaves<T extends { marketValue: number }>(candidates: T[], teamCount: number, startMs: number): (T & { opensAtMs: number | null })[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auctions/__tests__/seedingWaves.test.ts`:

```ts
/**
 * Gaffa — staggered kickoff release
 *
 * seedHighValueAuctions used to open an auction for EVERY unowned player above
 * the elite threshold at once — 14-25 of them in a 6-team league, against six
 * managers. Nobody had to compete for anyone, so every price settled on the
 * floor. A floor can only produce "at least X"; only competition produces "at
 * or slightly above market value".
 */

import { describe, it, expect } from 'vitest';
import { WAVE_INTERVAL_MS, waveSizeForLeague, assignReleaseWaves } from '../seedingWaves';

const T0 = Date.parse('2026-08-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const player = (marketValue: number, id = String(marketValue)) => ({ id, marketValue });

describe('waveSizeForLeague', () => {
    it('is about half the league, so ~2 managers chase each live auction', () => {
        expect(waveSizeForLeague(6)).toBe(3);
        expect(waveSizeForLeague(8)).toBe(4);
        expect(waveSizeForLeague(10)).toBe(5);
    });

    it('never drops below 2, so a tiny league still releases something', () => {
        expect(waveSizeForLeague(4)).toBe(2);
        expect(waveSizeForLeague(2)).toBe(2);
        expect(waveSizeForLeague(1)).toBe(2);
        expect(waveSizeForLeague(0)).toBe(2);
    });
});

describe('assignReleaseWaves', () => {
    it('opens the first wave immediately', () => {
        const out = assignReleaseWaves([player(100), player(90), player(80)], 6, T0);
        for (const p of out) expect(p.opensAtMs).toBeNull();
    });

    it('releases in descending market value', () => {
        const input = [player(50), player(200), player(90), player(120)];
        const out = assignReleaseWaves(input, 6, T0);
        expect(out.map((p) => p.marketValue)).toEqual([200, 120, 90, 50]);
    });

    it('spaces waves by the interval', () => {
        // 6 teams -> waves of 3. Seven players -> waves at +0, +3d, +6d.
        const input = [90, 85, 80, 75, 70, 65, 60].map((v) => player(v));
        const out = assignReleaseWaves(input, 6, T0);
        expect(out.slice(0, 3).map((p) => p.opensAtMs)).toEqual([null, null, null]);
        expect(out.slice(3, 6).map((p) => p.opensAtMs))
            .toEqual([T0 + WAVE_INTERVAL_MS, T0 + WAVE_INTERVAL_MS, T0 + WAVE_INTERVAL_MS]);
        expect(out[6].opensAtMs).toBe(T0 + 2 * WAVE_INTERVAL_MS);
    });

    it('uses a three-day interval', () => {
        expect(WAVE_INTERVAL_MS).toBe(3 * DAY);
    });

    it('clears a realistic pool inside the August window', () => {
        const input = Array.from({ length: 25 }, (_, i) => player(200 - i * 5));
        const out = assignReleaseWaves(input, 6, T0);
        const last = Math.max(...out.map((p) => p.opensAtMs ?? T0));
        expect((last - T0) / DAY).toBeLessThanOrEqual(25);
    });

    it('handles an empty pool', () => {
        expect(assignReleaseWaves([], 6, T0)).toEqual([]);
    });

    it('does not mutate the input array order', () => {
        const input = [player(50), player(200)];
        const snapshot = input.map((p) => p.marketValue);
        assignReleaseWaves(input, 6, T0);
        expect(input.map((p) => p.marketValue)).toEqual(snapshot);
    });

    it('preserves every candidate exactly once', () => {
        const input = Array.from({ length: 17 }, (_, i) => player(100 - i, `p${i}`));
        const out = assignReleaseWaves(input, 8, T0);
        expect(out).toHaveLength(17);
        expect(new Set(out.map((p) => p.id)).size).toBe(17);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test src/lib/auctions`
Expected: FAIL — `Failed to resolve import "../seedingWaves"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auctions/seedingWaves.ts`:

```ts
/**
 * Gaffa — staggered elite-tier release at season kickoff
 *
 * Kickoff used to open an auction for every unowned player at or above the
 * elite threshold simultaneously. In a 6-team league that is 14-25 live
 * auctions against six managers, so nobody had to outbid anyone and every
 * price settled on the floor.
 *
 * Releasing in waves forces managers onto the same targets, which is the only
 * thing that pushes a price past market value — a floor can only guarantee a
 * minimum. Descending by market value puts the marquee names out first, while
 * every manager still holds a full budget, which is where competition should
 * peak. Later waves meet depleted budgets and clear cheaper, which is the
 * correct structure: the best players command premiums and the rest do not. It
 * also matches how a real window unfolds, with the biggest business early.
 *
 * Only the elite tier is staggered. Promoted-club players are numerous (50-70)
 * and cheap, are not the scarcity problem, and holding them back would block
 * routine roster building. Mid-season arrivals need no staggering either — the
 * nightly sweep already surfaces them one or two at a time.
 *
 * Design doc: docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md
 */

/** Gap between waves. Matches the 72h initial window, so a wave has largely resolved before the next lands. */
export const WAVE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Players per wave: about half the league, so roughly two managers are chasing
 * each live elite auction whatever the league size. Never below 2 — a
 * single-player wave is a monopoly, not an auction.
 */
export function waveSizeForLeague(teamCount: number): number {
    const half = Math.round((Number.isFinite(teamCount) ? teamCount : 0) / 2);
    return Math.max(2, half);
}

/**
 * Sort candidates by descending market value and assign each a release time.
 * The first wave gets `null`, meaning "open immediately" — the same value every
 * non-kickoff seeding path writes.
 *
 * Does not mutate the input.
 */
export function assignReleaseWaves<T extends { marketValue: number }>(
    candidates: T[],
    teamCount: number,
    startMs: number,
): (T & { opensAtMs: number | null })[] {
    const size = waveSizeForLeague(teamCount);
    return [...candidates]
        .sort((a, b) => b.marketValue - a.marketValue)
        .map((c, i) => {
            const wave = Math.floor(i / size);
            return { ...c, opensAtMs: wave === 0 ? null : startMs + wave * WAVE_INTERVAL_MS };
        });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test src/lib/auctions`
Expected: PASS.

- [ ] **Step 5: Use it in season kickoff**

In `src/lib/offseason/seasonKickoff.ts`, replace the seeding block (lines 258–278, as amended by Task 5) with:

```ts
  if (playersToAuction.length > 0) {
    const { quietHours } = await getLeagueAuctionSettings(admin, leagueId);
    const now = Date.now();

    // Only the elite tier is staggered. Promoted-club players are cheap and
    // numerous, and delaying them would block routine roster building.
    const elite = playersToAuction.filter((p) => Number(p.marketValue || 0) >= AUCTION_THRESHOLD);
    const rest = playersToAuction.filter((p) => Number(p.marketValue || 0) < AUCTION_THRESHOLD);

    const { count: teamCount } = await admin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    const waved = assignReleaseWaves(elite, teamCount ?? 0, now);

    const auctionInserts = [
      ...waved.map((p) => ({ player: p, opensAtMs: p.opensAtMs })),
      ...rest.map((p) => ({ player: p, opensAtMs: null as number | null })),
    ].map(({ player, opensAtMs }) => ({
      league_id: leagueId,
      team_id: null,
      player_id: player.id,
      faab_bid: 0,
      priority: 999,
      status: 'pending',
      gameweek: 0,
      is_auction: true,
      // The 72h window runs from when the auction OPENS, not from kickoff —
      // otherwise a wave four releases already expired.
      expires_at: initialAuctionExpiry(opensAtMs ?? now, quietHours),
      opens_at: opensAtMs === null ? null : new Date(opensAtMs).toISOString(),
      // Reference price for the auction premium — see migration 070.
      market_value_at_auction: player.marketValue,
    }));

    const { error: insertErr } = await admin.from('waiver_claims').insert(auctionInserts);
    if (insertErr) throw new Error(`Failed to create summer auctions: ${insertErr.message}`);
  }
```

Add the import:

```ts
import { assignReleaseWaves } from '@/lib/auctions/seedingWaves';
```

> **The `expires_at` detail matters.** It is computed from `opensAtMs`, not from `now`. Computing it from kickoff would make wave four's auctions expire before they ever opened.

- [ ] **Step 6: Typecheck, test and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm test && npm run build`
Expected: no typecheck output, tests PASS, build completes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auctions/seedingWaves.ts src/lib/auctions/__tests__/seedingWaves.test.ts \
        src/lib/offseason/seasonKickoff.ts
git commit -m "feat(auctions): release the elite tier in waves at kickoff instead of all at once"
```

---

## Task 7: Enforce and surface `opens_at`

**Files:**
- Modify: `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`
- Modify: `src/app/api/leagues/[leagueId]/auctions/route.ts:84-128`
- Modify: `src/app/(dashboard)/league/[leagueId]/players/page.tsx:50-126`
- Modify: `src/types/index.ts:479`

**Interfaces:**
- Consumes: `waiver_claims.opens_at` from Task 1.
- Produces: `opens_at: string | null` on the `AuctionListing` type.

The enforcement is **one guard in the bid route**. The two list builders only pass the field through, so an unopened auction stays visible with an "opens in Xd" state — hiding it would recreate the information asymmetry §8 of the guide disclaims.

- [ ] **Step 1: Reject bids on an unopened auction**

In `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`, extend the existing system-seed read (the `systemSeedClaim` query around line 272) to include the new column:

```ts
    .select('expires_at, first_bid_at, opens_at')
```

Then immediately after the existing expiry check:

```ts
  if (systemSeedClaim?.expires_at && new Date().getTime() >= new Date(systemSeedClaim.expires_at).getTime()) {
    return NextResponse.json(
      { error: 'This auction has already expired and is awaiting processing.' },
      { status: 400 },
    );
  }
```

add:

```ts
  // Staggered release: season kickoff seeds the elite tier with future opens_at
  // values so managers compete for the same players instead of picking from
  // 14-25 simultaneous auctions. Every other seeding path writes NULL.
  //
  // This is the ONLY enforcement point. The auction list deliberately still
  // shows unopened auctions so managers can plan budgets across the window.
  if (systemSeedClaim?.opens_at && new Date().getTime() < new Date(systemSeedClaim.opens_at).getTime()) {
    const opensAt = new Date(systemSeedClaim.opens_at);
    return NextResponse.json(
      { error: `This auction opens on ${opensAt.toUTCString()}. Bidding is not open yet.` },
      { status: 400 },
    );
  }
```

- [ ] **Step 2: Add the field to the shared type**

In `src/types/index.ts`, add to the `AuctionListing` interface, next to `my_bid` at line 479:

```ts
  /** Future ISO timestamp when a staggered kickoff auction opens; null means open now. */
  opens_at: string | null;
```

- [ ] **Step 3: Pass it through the API route**

In `src/app/api/leagues/[leagueId]/auctions/route.ts`, the claims query at line 86 already selects `*`, so `opens_at` is present on each row. Add it to the `auctionMap.set(...)` object literal that starts at line 117, alongside `expires_at`:

```ts
        opens_at: claim.opens_at ?? null,
```

- [ ] **Step 4: Pass it through the duplicate builder**

`src/app/(dashboard)/league/[leagueId]/players/page.tsx` builds the same shape independently from `rawClaims` (line 50). Add the identical line to its `auctionMap.set(...)` object around line 126:

```ts
        opens_at: claim.opens_at ?? null,
```

Verify the page's claims query also selects the column:

Run: `sed -n '50,56p' "src/app/(dashboard)/league/[leagueId]/players/page.tsx"`
If it selects specific columns rather than `*`, add `opens_at` to the list.

> **These two builders duplicate the same claim-grouping logic.** Collapsing them is worth doing and is out of scope here, but the field must land in **both** — one without it produces a page where unopened auctions look biddable.

- [ ] **Step 5: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes. If `tsc` reports `opens_at` missing on an object literal, that is the duplicate builder — fix it rather than casting.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/leagues/[leagueId]/auctions/bid/route.ts" \
        "src/app/api/leagues/[leagueId]/auctions/route.ts" \
        "src/app/(dashboard)/league/[leagueId]/players/page.tsx" \
        src/types/index.ts
git commit -m "feat(auctions): reject bids before opens_at, surface it to both auction views"
```

---

## Task 8: Show the release state and the new floor

**Files:**
- Modify: `src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx`

**Interfaces:**
- Consumes: `opens_at` on `AuctionListing` from Task 7; the floor setting from Task 4.
- Produces: no new exports — UI only.

- [ ] **Step 1: Add a helper for the release state**

In `TransferMarketClient.tsx`, add near the other module-level helpers:

```tsx
/** Human label for a staggered auction that has not opened yet, or null if it is live. */
function opensInLabel(opensAt: string | null | undefined): string | null {
  if (!opensAt) return null;
  const ms = new Date(opensAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `Opens in ${hours}h`;
  return `Opens in ${Math.ceil(hours / 24)}d`;
}
```

- [ ] **Step 2: Render it on the auction card and disable the bid button**

In the auction row's render scope, compute the state:

```tsx
                        const opensLabel = opensInLabel(auction.opens_at);
```

The bid button at line 725 currently reads:

```tsx
                          disabled={isExpired || (auction.is_promoted_exclusive && !auction.is_eligible)}
```

Change it to:

```tsx
                          disabled={isExpired || !!opensLabel || (auction.is_promoted_exclusive && !auction.is_eligible)}
```

The button's label is chosen by the ternary chain immediately below that line (`isExpired ? ... : auction.is_promoted_exclusive && !auction.is_eligible ? ... : ...`). Add an `opensLabel` branch as the **second** condition, after `isExpired`, so an unopened auction shows "Opens in 2d" rather than the exclusivity message.

Then render the label as a badge on the card beside the existing expiry display, using an existing muted or warning class from the component's CSS module and existing `--color-*` tokens.

The card must remain **visible and readable** — only bidding is blocked. Managers need to see what is coming to plan budgets across the window.

- [ ] **Step 3: Update the minimum-bid copy in the modal**

Find where the modal displays the minimum bid or market value and make sure it reflects the league floor rather than a hardcoded 20%. If the component computes a minimum locally, pass the league's `free_agent_bid_floor` down from the page rather than duplicating the constant:

Run: `grep -n "0.2\|20%\|Transfermarkt" "src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx"`
Fix every hit. The server rejects a bid below the floor either way, but a form that suggests €12m when the server demands €30m is a bug users will report.

- [ ] **Step 4: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 5: Verify in the browser**

Start the preview with the `preview_start` tool using the dev-server entry in `.claude/launch.json` — **never** run a dev server through Bash, and check whether another session already owns port 3000 or 3010.

Navigate to `/league/<id>/players`, then:
- `read_page` to confirm an unopened auction shows its "Opens in Xd" badge and a disabled bid button.
- `read_console_messages` to confirm no errors.
- `resize_window` with `colorScheme: 'dark'`, screenshot, then light, to check both themes.

If no staggered auction exists in the dev data, temporarily set one to verify, then revert:

```sql
UPDATE public.waiver_claims SET opens_at = NOW() + INTERVAL '2 days'
WHERE id = (SELECT id FROM public.waiver_claims WHERE team_id IS NULL AND status = 'pending' LIMIT 1);
-- revert: UPDATE public.waiver_claims SET opens_at = NULL WHERE opens_at IS NOT NULL;
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx"
git commit -m "feat(transfers): show staggered release state and the league bid floor"
```

---

## Task 9: Pin the pre-draft invariant

No behavioural change. The desired behaviour already holds; this makes it explicit so it cannot be broken silently.

**Files:**
- Modify: `src/lib/auctions/seedHighValueAuctions.ts:47-53`
- Modify: `src/lib/auctions/__tests__/seedingWaves.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Document the invariant at the gate**

In `src/lib/auctions/seedHighValueAuctions.ts`, replace the league query with a commented version:

```ts
  // INVARIANT: nothing may be auctioned before a league has drafted.
  //
  // `status = 'active'` is what enforces it — a league is 'setup' or 'drafting'
  // until the final pick lands, so a €90m arrival on August 12th with a draft
  // scheduled for the 15th creates no auction and instead falls into the draft
  // pool, which draft/page.tsx builds from `players` where is_active = true with
  // no snapshot or cutoff.
  //
  // This filter reads like "leagues in play", so widening it would silently
  // start auctioning players out from under an undrafted league. Do not relax it
  // without replacing the guarantee. Asserted in
  // src/lib/auctions/__tests__/seedingWaves.test.ts.
  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, previous_season')
    .eq('status', 'active')
    .eq('roster_locked', false);
```

- [ ] **Step 2: Write a test that fails if the gate is widened**

Append to `src/lib/auctions/__tests__/seedingWaves.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A source-level assertion rather than a behavioural one: seedHighValueAuctions
 * takes a live Supabase client and sweeps every league, so exercising it needs a
 * database this repo has no harness for. What can be pinned cheaply is the gate
 * itself — the single filter that keeps an undrafted league's players out of
 * auctions. If someone widens or removes it, this fails and points at the
 * invariant instead of surfacing months later as players vanishing from a draft.
 */
describe('pre-draft invariant', () => {
    const source = readFileSync(
        join(process.cwd(), 'src/lib/auctions/seedHighValueAuctions.ts'),
        'utf8',
    );

    it('still gates the sweep on status = active', () => {
        expect(source).toContain(`.eq('status', 'active')`);
    });

    it('still documents why, so the next reader does not relax it', () => {
        expect(source).toContain('INVARIANT');
        expect(source).toMatch(/before a league has drafted/i);
    });

    it('never sweeps a roster-locked league either', () => {
        expect(source).toContain(`.eq('roster_locked', false)`);
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test src/lib/auctions`
Expected: PASS.

- [ ] **Step 4: Prove the test can fail**

Temporarily change `.eq('status', 'active')` to `.eq('status', 'drafting')` in the source, re-run `npm test src/lib/auctions`, and confirm the invariant test FAILS. Then revert the change and re-run to confirm it passes. A guard test that cannot fail is worthless.

- [ ] **Step 5: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auctions/seedHighValueAuctions.ts src/lib/auctions/__tests__/seedingWaves.test.ts
git commit -m "test(auctions): pin the invariant that undrafted leagues seed no auctions"
```

---

## Task 10: Update the guide and close two open questions

**Files:**
- Modify: `docs/USER_GUIDE.md` — §8 and the Quick Glossary
- Modify: `docs/drafts/OPEN_RULES_QUESTIONS.md` — items 1 and 2

**Interfaces:**
- Consumes: every value settled in Tasks 1–9.
- Produces: documentation only.

The guide states *"every figure here is a league setting or a code constant, verified against the source."* Re-read the constants rather than copying from this plan.

- [ ] **Step 1: Rewrite the §8 pricing and timing rules**

In `docs/USER_GUIDE.md` §8, replace the minimum-bid rule and the "How long an auction runs" subsection. Replace:

```markdown
- **Your bid must beat the current high.** Matching it is rejected, as is lowering your own standing bid. There is therefore no such thing as a tied bid.
```

with:

```markdown
- **Your bid must beat the current high.** Matching it is rejected, as is lowering your own standing bid. There is therefore no such thing as a tied bid.
- **The minimum bid for a free agent is 50% of his market value.** A €60m player costs at least €30m. A player another manager has listed is floored at **80%** instead, set by the seller.

**Why a floor at all, and why 50%?** Because a €60m footballer who costs €12m isn't a decision. Before this floor existed, an entire window's shopping came to about a fifth of a starting budget, and money never really bit. 50% makes a signing cost something while stopping short of the 80% a listing carries — a free agent is, by definition, someone nobody drafted, and market value reflects real footballing worth rather than fantasy usefulness. A €60m squad defender at a big club is genuinely worth €60m and genuinely worth very little to you, and the market needs room to say so.
```

Then replace the entire "How long an auction runs" table and its notes — including the **"Known limitation"** blockquote about sniping — with:

```markdown
### How long an auction runs

There is no fixed window and no hard deadline. The clock follows the bidding:

| | |
|---|---|
| Sits open before the first bid | **72 hours** |
| Then stays open at least | **24 hours** after the first bid |
| And closes once bidding has been quiet for | **12 hours**, shrinking as the auction ages |

The quiet period tightens the longer an auction runs — 12 hours for the first two days, then 4, then 2, then **1 hour** once it passes four days. So a quiet auction ends the day after it goes quiet, while a genuinely contested one converges quickly to a flurry of hour-long windows.

**Every bid moves the close later. There is no moment you can time.** A contested auction ends when somebody stops paying, not when a clock runs out — which is the honest way to settle an auction, and it means there is nothing to snipe.

**Nothing resolves overnight.** No auction can close inside your league's quiet hours (by default midnight to 8am). An auction that would have ended at 4am ends at 8am instead, so you never lose a player while you're asleep.
```

- [ ] **Step 2: Document the staggered release**

Append to §8, after the auction-timing section:

```markdown
### Marquee players arrive in waves

At the start of a season, the most expensive unowned players are **not** all put up at once. They're released in waves — a few every three days, most valuable first — and you can see the upcoming ones on the transfer board marked with when they open.

**Why?** Because when twenty elite players are available simultaneously and there are six of you, nobody has to outbid anybody. Everyone takes a different name at the minimum price, and a €90m striker goes for a fraction of what he's worth. Releasing a handful at a time means you and a rival actually want the same player, which is the only thing that makes a price mean anything.

The knock-on effect is intentional: the biggest names go early, while everyone still has a full budget, and later waves are cheaper. That's the same shape a real window has.

Cheaper players — including everyone at a newly-promoted club — go up straight away and aren't staggered.
```

- [ ] **Step 3: Update the Quick Glossary**

Add:

```markdown
| **Bid floor** | The minimum you can bid: 50% of market value for a free agent, or the seller's ask (at least 80%) for a listed player. |
| **Quiet hours** | The overnight window, by default midnight to 8am, in which no auction may close. |
```

- [ ] **Step 4: Close out the two open questions**

In `docs/drafts/OPEN_RULES_QUESTIONS.md`:

Change item 1's heading to `## 1. RESOLVED — The hard ceiling reopens sniping on contested auctions` and append:

```markdown
**Resolved 2026-07-30.** The ceiling is gone. `expires_at` is now
`quietHoursGuard(max(first + 24h, last + timeout(age)))` with the inactivity
timeout decaying 12h → 4h → 2h → 1h, so every bid moves the close and duration is
bounded by economics rather than a wall — sustaining an auction needs a bid every
hour at a strictly higher price. Your "make the ceiling soft" ruling was adopted
essentially as written.

Two things the original writeup missed. The `"Closing inside the hour"` facet is
now **kept** — with no timeable instant it is a useful filter rather than a
sniper's target list. And a separate defect surfaced while fixing this: nothing in
the formula protected the *time of day*. The docblock claimed a 3am bid could not
close at 4am, but `MIN_DURATION` is 24h, so a 3am first bid floored at 3am the next
day, and a 3pm last bid closed at 3am. Roughly half of all closes landed
overnight. A quiet-hours guard now prevents any close inside a configurable
window, default midnight to 8am.
```

Change item 2's heading to `## 2. RESOLVED — Two different initial expiry values for a seeded auction` and append:

```markdown
**Resolved 2026-07-30. There were five, not two.** Alongside
`seedHighValueAuctions.ts` (48h) and `timer.ts` (72/96h): `seasonKickoff.ts:26`
(96h), `executeDrop.ts` (48/96h) and the `062` resolver's dropped-player
re-auction (48/96h). The two drop paths also disagreed on the big-transfer
threshold — 50 in `executeDrop.ts` against 40 everywhere else.

All five now call `initialAuctionExpiry()`, which opens a single **72h**
pre-first-bid window. Deleting the hard ceiling also removed both places market
value affected duration, so the `isBigTransfer` parameter came off
`calculateExpiresAt()` and `initialAuctionExpiry()` entirely rather than being
left as an argument that no longer changed the result.
```

- [ ] **Step 5: Verify every documented number against the source**

Run: `grep -n "MIN_DURATION_MS\|INITIAL_WINDOW_MS\|timeoutMs:\|DEFAULT_QUIET_HOURS" src/lib/auction/timer.ts && grep -n "DEFAULT_BID_FLOOR" src/lib/auction/leagueAuctionSettings.ts && grep -n "WAVE_INTERVAL_MS =" src/lib/auctions/seedingWaves.ts`

Expected: 24h, 72h, the four decay bands (12h/4h/2h/1h), 00:00–08:00, 0.5, and 3 days. Cross-check each against what you wrote in the guide and fix any divergence.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 7: Commit**

```bash
git add docs/USER_GUIDE.md docs/drafts/OPEN_RULES_QUESTIONS.md
git commit -m "docs: document the 50% floor, wave releases and the new auction close rules"
```

---

## Final verification

- [ ] **Full test suite**

Run: `npm test`
Expected: PASS across `src/lib/auction/__tests__/`, `src/lib/auctions/__tests__/`, `src/lib/scoring/__tests__/`, and — if the economy plan has landed — `src/lib/economy/__tests__/` and `src/lib/offseason/__tests__/`.

- [ ] **Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output.

- [ ] **Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Build**

Run: `npm run build`
Expected: completes without errors. **The project's only correctness gate besides the tests — do not report the work done until it passes.**

- [ ] **Confirm the migrations with the user**

Two migrations must be applied by hand in the Supabase SQL editor, in order:

1. `093_auction_pricing_settings.sql` — bid floor, quiet hours, `waiver_claims.opens_at`
2. `094_reauction_expiry_72h.sql` — resolver re-auction window → 72h

**Neither the floor nor the staggered release takes effect until these are run**, and the user must additionally set `auction_timezone`, which has no default:

```sql
UPDATE public.leagues SET auction_timezone = 'America/New_York';
```

State whether `094` was copied from `091_solidarity_on_auctions.sql` or from `062_severance_rate_update.sql`, so the user knows whether the solidarity logic survived.

- [ ] **Report honestly what was and was not verified**

Covered by unit tests: the timer (decay bands, quiet-hours guard, the no-freeze property, ISO output), the wave partitioning, and the pre-draft gate as a source-level assertion.

**Not covered:** the resolver RPC (no database test harness exists in this repo and one was deliberately not built), and the end-to-end behaviour of a staggered auction actually opening at its `opens_at`. Verification for those is the manual SQL above plus the browser check in Task 8. Say so plainly rather than describing them as tested.

**One thing this plan cannot verify at all:** whether a 50% floor produces prices at or slightly above market value in practice. That depends on how six real managers bid, which no simulation settles. `free_agent_bid_floor` is a league setting precisely so it can be retuned after one real window, and the economy plan's money-created-versus-destroyed readout on the Finance page is the instrument for judging it.
