# Gaffa Economy Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retime Gaffa's regular-season prize money into monthly in-season merit payments, recirculate a share of burned transfer money back into the league, and rebalance the prize curves — so Club Balance behaves like a working currency during a season.

**Architecture:** All arithmetic lives in two new pure TypeScript modules under `src/lib/economy/` that are unit-tested with vitest. Money movement stays in Postgres RPCs (matching the existing pattern where bid resolution, prize credits and trade execution are all stored procedures), because balance mutations must be atomic with their transaction rows. Every rate becomes a `leagues` column so it can be tuned without a migration.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres) via `@supabase/supabase-js`, vitest 4 for unit tests, CSS Modules.

## Global Constraints

- **Source of truth for the design:** `docs/superpowers/specs/2026-07-29-economy-rebalance-design.md`. Read it before starting.
- **`teams.faab_budget` is an `INT` column.** Every credit and debit must be a whole number of millions. Compute with floats, then `FLOOR` before writing. Remainders burn — never distribute fractional millions.
- **Migrations are applied by hand** in the Supabase SQL editor. There is no local migration runner, so a new `.sql` file is *not* live until the user runs it. Never assume a migration has been applied.
- **`npm run build` must pass before any task is considered done.** This project has no CI; the build is the only automated correctness gate besides the unit tests.
- **Run tests with `npm test`** (`vitest run`). If `npm test` fails to resolve on PATH, use `node node_modules/vitest/vitest.mjs run`.
- **Typecheck with `node node_modules/typescript/bin/tsc --noEmit`.** There is no npm script for it.
- **User-facing copy never says "FAAB".** The DB column is `faab_budget`, but all UI text, emails and error messages say **"Club Balance"** (or "budget"), formatted as `€{n}m`.
- **Never hardcode the season string.** Derive it from `getCurrentFplSeason()` in `src/lib/season/currentSeason.ts`, or read `leagues.current_season`.
- **Migration numbering:** When this plan was written the head was `088`. This workspace already has `089_autopick_stats_weighting.sql` and `090_fix_previous_season_default.sql`, so the economy migrations are **`091`–`094`** (renumbered from the original 089–092). Check `ls supabase/migrations | tail` before creating one.
- **Never key durable data on an FPL team id or fixture id.** Not directly relevant to these tasks, but if you touch club identity, read the "Club identity" section of `CLAUDE.md` first.

---

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `src/lib/economy/meritPayments.ts` | Pure arithmetic for merit periods and payments. No DB access. | Create (Task 2) |
| `src/lib/economy/__tests__/meritPayments.test.ts` | Unit tests for the above. | Create (Task 2) |
| `src/lib/economy/payMeritPeriod.ts` | DB orchestration: read matchups for a period, tally, call the RPC. | Create (Task 4) |
| `src/lib/economy/solidarity.ts` | Pure arithmetic for the recirculation split. No DB access. | Create (Task 6) |
| `src/lib/economy/__tests__/solidarity.test.ts` | Unit tests for the above. | Create (Task 6) |
| `supabase/migrations/091_economy_settings.sql` | League rate columns; `faab_budget` default fix; departure rate default. | Create (Task 1) |
| `supabase/migrations/092_merit_payments.sql` | `merit_payments` table, `merit_payment` enum value, `credit_merit_payment` RPC. | Create (Task 3) |
| `supabase/migrations/093_solidarity_on_auctions.sql` | Replaces the rebate block in `resolve_single_player_auction_rpc`. | Create (Task 7) |
| `supabase/migrations/094_solidarity_on_drops_and_buyback.sql` | `distribute_solidarity` helper + buyback RPC update. | Create (Task 8) |
| `src/lib/scoring/matchupProcessor.ts` | Gains the merit-payment hook at gameweek resolution. | Modify (Task 4) |
| `src/lib/offseason/prizeDistribution.ts` | New placement curve endpoints and cup config. | Modify (Task 5) |
| `src/lib/offseason/__tests__/prizeDistribution.test.ts` | Unit tests for the curve. | Create (Task 5) |
| `src/lib/transfers/compensation.ts` | `COMPENSATION_RATE` fallback 0.8 → 0.6. | Modify (Task 1) |
| `src/lib/roster/executeDrop.ts` | Standalone-drop severance calls the solidarity helper. | Modify (Task 8) |
| `src/app/(dashboard)/league/[leagueId]/finance/page.tsx` | New transaction categories; net-created readout. | Modify (Task 9) |
| `src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx` | Committed-vs-available bid disclosure. | Modify (Task 10) |
| `src/lib/scoring/matchRating.ts` | Delete the unreachable `-2.0` points penalty. | Modify (Task 11) |
| `docs/USER_GUIDE.md` | §8, §11, §13, §14 and the Quick Glossary. | Modify (Task 12) |
| `CLAUDE.md` | Correct the stale "no test runner" and "seven formations" claims. | Modify (Task 12) |

**Note on where the tests live.** `vitest.config.ts` includes only `src/**/__tests__/**/*.test.ts`, so new test directories under `src/lib/economy/` and `src/lib/offseason/` are picked up automatically with no config change.

**Note on SQL.** There is no database test harness in this repo, so RPC changes cannot be unit-tested. Each SQL task therefore ships with a manual verification query the user runs in the Supabase SQL editor, and the TypeScript that calls the RPC is covered by the pure-module tests. Do not invent a DB test harness for this plan.

---

## Task 1: Economy settings columns and two default fixes

Foundation task. Later RPCs read these columns, so this lands first.

**Files:**
- Create: `supabase/migrations/091_economy_settings.sql`
- Modify: `src/lib/transfers/compensation.ts:34`

**Interfaces:**
- Consumes: nothing.
- Produces: `leagues.merit_win`, `leagues.merit_draw`, `leagues.merit_loss`, `leagues.merit_bye` (all `NUMERIC(5,2)`), `leagues.solidarity_share`, `leagues.scout_share` (both `NUMERIC(4,3)`). Exported constant `COMPENSATION_RATE = 0.6` from `src/lib/transfers/compensation.ts`.

- [ ] **Step 1: Confirm the migration head**

Run: `ls supabase/migrations | tail -3`
Expected: highest numeric migration is already ≥090 in this workspace; economy files are 091–094. If a higher number than 090 exists beyond those, bump accordingly.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/091_economy_settings.sql`:

```sql
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
```

- [ ] **Step 3: Update the compensation fallback constant**

In `src/lib/transfers/compensation.ts`, change line 34 and amend the docblock above it. Replace:

```ts
export const COMPENSATION_RATE = 0.8;
```

with:

```ts
export const COMPENSATION_RATE = 0.6;
```

Then, in the docblock immediately above it, replace the paragraph beginning `A previous version set this to 1.0 to dodge a rounding artefact` — keep that paragraph, and append this one after it:

```
 * Lowered from 0.8 to 0.6 by migration 091. Two reasons: departure
 * compensation was the second-largest source of newly created money in the
 * league (~EUR 152m/season for six clubs), and at 0.8 the payout was
 * generous enough that releasing beat retaining in almost every case,
 * leaving the Retained List as dead weight. At 0.6, holding rights is a
 * real decision.
```

- [ ] **Step 4: Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output (success). The constant is a plain number change, so nothing should break.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 6: Hand the migration to the user**

Tell the user: *"Migration 091 is ready. Run it in the Supabase SQL editor before Task 3, because the merit RPC reads `merit_win`/`merit_draw`/`merit_loss`/`merit_bye`."* Do not proceed past Task 2 assuming it has been applied.

Verification query for the user to run after applying:

```sql
SELECT merit_win, merit_draw, merit_loss, merit_bye,
       solidarity_share, scout_share, departure_compensation_rate
FROM public.leagues;
```

Expected: `2.50 | 1.50 | 0.50 | 1.50 | 0.200 | 0.500 | 0.6` for every row.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/091_economy_settings.sql src/lib/transfers/compensation.ts
git commit -m "feat(economy): add merit/solidarity league settings, drop departure rate to 0.6, fix faab default"
```

---

## Task 2: Merit payment pure arithmetic

Pure functions, no DB. This is where the period boundaries and the payment formula live, and it is fully unit-testable.

**Files:**
- Create: `src/lib/economy/meritPayments.ts`
- Create: `src/lib/economy/__tests__/meritPayments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MERIT_PERIOD_LENGTH: 4`, `TOTAL_GAMEWEEKS: 38`, `MERIT_PERIOD_COUNT: 10`
  - `interface MeritRates { win: number; draw: number; loss: number; bye: number }`
  - `DEFAULT_MERIT_RATES: MeritRates`
  - `interface TeamRecord { wins: number; draws: number; losses: number; byes: number }`
  - `interface MatchupResultRow { gameweek: number; team_a_id: string; team_b_id: string; winner_team_id: string | null; status: string }`
  - `periodIndexForGameweek(gameweek: number): number | null`
  - `gameweeksInPeriod(periodIndex: number): number[]`
  - `computeMeritPayment(record: TeamRecord, rates: MeritRates): number`
  - `tallyPeriodRecords(rows: MatchupResultRow[], teamIds: string[], gameweeks: number[]): Map<string, TeamRecord>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/economy/__tests__/meritPayments.test.ts`:

```ts
/**
 * Gaffa — monthly merit income arithmetic
 *
 * These lock in three things that are easy to break by adjusting rates:
 *   1. Period boundaries land on GW4/8/.../36 plus a short final period of
 *      GW37-38, and every gameweek belongs to exactly one period.
 *   2. Default rates always produce a WHOLE number of millions, because
 *      teams.faab_budget is an INT column.
 *   3. A bye is paid, not skipped — odd-sized leagues have one every week.
 */

import { describe, it, expect } from 'vitest';
import {
    MERIT_PERIOD_COUNT,
    TOTAL_GAMEWEEKS,
    DEFAULT_MERIT_RATES,
    periodIndexForGameweek,
    gameweeksInPeriod,
    computeMeritPayment,
    tallyPeriodRecords,
} from '../meritPayments';
import type { MatchupResultRow } from '../meritPayments';

describe('periodIndexForGameweek', () => {
    it('returns a period index only on a boundary gameweek', () => {
        expect(periodIndexForGameweek(4)).toBe(1);
        expect(periodIndexForGameweek(8)).toBe(2);
        expect(periodIndexForGameweek(36)).toBe(9);
        expect(periodIndexForGameweek(38)).toBe(10);
    });

    it('returns null on a non-boundary gameweek', () => {
        for (const gw of [1, 2, 3, 5, 7, 35, 37]) {
            expect(periodIndexForGameweek(gw)).toBeNull();
        }
    });

    it('returns null outside the season', () => {
        expect(periodIndexForGameweek(0)).toBeNull();
        expect(periodIndexForGameweek(39)).toBeNull();
        expect(periodIndexForGameweek(-4)).toBeNull();
    });
});

describe('gameweeksInPeriod', () => {
    it('gives four gameweeks for periods 1-9', () => {
        expect(gameweeksInPeriod(1)).toEqual([1, 2, 3, 4]);
        expect(gameweeksInPeriod(9)).toEqual([33, 34, 35, 36]);
    });

    it('gives the two-gameweek final period', () => {
        expect(gameweeksInPeriod(10)).toEqual([37, 38]);
    });

    it('covers every gameweek exactly once across all periods', () => {
        const seen: number[] = [];
        for (let p = 1; p <= MERIT_PERIOD_COUNT; p++) seen.push(...gameweeksInPeriod(p));
        expect(seen).toHaveLength(TOTAL_GAMEWEEKS);
        expect(new Set(seen).size).toBe(TOTAL_GAMEWEEKS);
        expect(Math.min(...seen)).toBe(1);
        expect(Math.max(...seen)).toBe(TOTAL_GAMEWEEKS);
    });

    it('throws on an out-of-range period', () => {
        expect(() => gameweeksInPeriod(0)).toThrow();
        expect(() => gameweeksInPeriod(11)).toThrow();
    });
});

describe('computeMeritPayment', () => {
    const r = DEFAULT_MERIT_RATES;

    it('pays the documented amounts for a four-match period', () => {
        expect(computeMeritPayment({ wins: 4, draws: 0, losses: 0, byes: 0 }, r)).toBe(10);
        expect(computeMeritPayment({ wins: 3, draws: 1, losses: 0, byes: 0 }, r)).toBe(9);
        expect(computeMeritPayment({ wins: 2, draws: 1, losses: 1, byes: 0 }, r)).toBe(7);
        expect(computeMeritPayment({ wins: 1, draws: 1, losses: 2, byes: 0 }, r)).toBe(5);
        expect(computeMeritPayment({ wins: 0, draws: 0, losses: 4, byes: 0 }, r)).toBe(2);
    });

    it('pays a bye at the draw rate', () => {
        const withBye = computeMeritPayment({ wins: 2, draws: 0, losses: 1, byes: 1 }, r);
        const withDraw = computeMeritPayment({ wins: 2, draws: 1, losses: 1, byes: 0 }, r);
        expect(withBye).toBe(withDraw);
    });

    it('pays nothing for an empty record', () => {
        expect(computeMeritPayment({ wins: 0, draws: 0, losses: 0, byes: 0 }, r)).toBe(0);
    });

    // faab_budget is an INT column. With win + loss = 2 x draw and an
    // even-length period, 2.5w + 1.5d + 0.5l + 1.5b is always an integer.
    // If this fails, someone changed a rate and payments will silently
    // truncate.
    it('yields whole millions for every possible record in both period lengths', () => {
        for (const n of [4, 2]) {
            for (let w = 0; w <= n; w++)
                for (let d = 0; d + w <= n; d++)
                    for (let b = 0; b + d + w <= n; b++) {
                        const l = n - w - d - b;
                        const paid = computeMeritPayment({ wins: w, draws: d, losses: l, byes: b }, r);
                        expect(Number.isInteger(paid)).toBe(true);
                    }
        }
    });
});

describe('tallyPeriodRecords', () => {
    const A = 'team-a', B = 'team-b', C = 'team-c';

    const row = (
        gameweek: number, a: string, b: string, winner: string | null,
    ): MatchupResultRow => ({
        gameweek, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed',
    });

    it('counts wins, losses and draws', () => {
        const rows = [row(1, A, B, A), row(2, A, B, B), row(3, A, B, null)];
        const t = tallyPeriodRecords(rows, [A, B], [1, 2, 3]);
        expect(t.get(A)).toEqual({ wins: 1, draws: 1, losses: 1, byes: 0 });
        expect(t.get(B)).toEqual({ wins: 1, draws: 1, losses: 1, byes: 0 });
    });

    it('counts a missing fixture as a bye, not a loss', () => {
        // C has no fixture in GW1 — an odd-sized league bye.
        const t = tallyPeriodRecords([row(1, A, B, A)], [A, B, C], [1]);
        expect(t.get(C)).toEqual({ wins: 0, draws: 0, losses: 0, byes: 1 });
    });

    it('ignores gameweeks outside the requested period', () => {
        const rows = [row(1, A, B, A), row(9, A, B, A)];
        const t = tallyPeriodRecords(rows, [A, B], [1, 2, 3, 4]);
        // GW9 excluded; GW2-4 are byes because no rows exist for them.
        expect(t.get(A)).toEqual({ wins: 1, draws: 0, losses: 0, byes: 3 });
    });

    it('ignores matchups that are not completed', () => {
        const live: MatchupResultRow = { ...row(1, A, B, null), status: 'live' };
        const t = tallyPeriodRecords([live], [A, B], [1]);
        // Not completed, so it is not a draw — it is treated as no fixture.
        expect(t.get(A)).toEqual({ wins: 0, draws: 0, losses: 0, byes: 1 });
    });

    it('returns an entry for every requested team', () => {
        const t = tallyPeriodRecords([], [A, B, C], [1]);
        expect([...t.keys()].sort()).toEqual([A, B, C].sort());
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test src/lib/economy`
Expected: FAIL — `Failed to resolve import "../meritPayments"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/economy/meritPayments.ts`:

```ts
/**
 * Gaffa — Monthly Merit Income
 *
 * The regular-season prize pool is paid DURING the season on match results
 * rather than as a lump sum at the offseason reset. Pure arithmetic only —
 * no database access — so the period boundaries and the payment formula can
 * be tested without a Supabase client.
 *
 * Why monthly rather than per-gameweek: cadence is independent of totals, and
 * batching identical money into ten statements a season turns a rounding
 * error into an event. Real clubs receive broadcast and merit money in
 * instalments, not per match.
 *
 * Design doc: docs/superpowers/specs/2026-07-29-economy-rebalance-design.md
 */

/** Gameweeks per merit period, for every period except the final short one. */
export const MERIT_PERIOD_LENGTH = 4;

/** A Premier League season is 38 gameweeks; the schedule generator fills to it. */
export const TOTAL_GAMEWEEKS = 38;

/** Nine periods of four gameweeks, plus a final period covering GW37-38. */
export const MERIT_PERIOD_COUNT = 10;

export interface MeritRates {
    win: number;
    draw: number;
    loss: number;
    /**
     * Odd-sized leagues get a virtual BYE team (see schedule/generator.ts), so
     * a club can have no fixture in a gameweek. A bye pays the draw rate: it
     * was neither earned nor lost.
     */
    bye: number;
}

/**
 * League defaults. Two properties matter and both are asserted in the tests:
 *
 *   win + loss = 2 x draw  ->  every match pays out exactly EUR 3.0m whatever
 *   the result, so the season's total outlay is deterministic.
 *
 *   A draw pays less than half a win. The 10-point draw band exists because a
 *   narrow margin is noise in the rating engine rather than a result, so a
 *   coin flip should not pay like a win.
 *
 * Per-league overrides live in leagues.merit_win / merit_draw / merit_loss /
 * merit_bye (migration 091).
 */
export const DEFAULT_MERIT_RATES: MeritRates = {
    win: 2.5,
    draw: 1.5,
    loss: 0.5,
    bye: 1.5,
};

export interface TeamRecord {
    wins: number;
    draws: number;
    losses: number;
    byes: number;
}

/** The subset of a `matchups` row this module needs. */
export interface MatchupResultRow {
    gameweek: number;
    team_a_id: string;
    team_b_id: string;
    winner_team_id: string | null;
    status: string;
}

/**
 * The period that CLOSES on this gameweek, or null if it is not a boundary.
 * Boundaries are GW4, 8, 12, 16, 20, 24, 28, 32, 36 and 38.
 *
 * Periods are counted in gameweeks rather than calendar months so the schedule
 * needs no fixture dates and the boundary is deterministic.
 */
export function periodIndexForGameweek(gameweek: number): number | null {
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > TOTAL_GAMEWEEKS) return null;
    if (gameweek === TOTAL_GAMEWEEKS) return MERIT_PERIOD_COUNT;
    if (gameweek % MERIT_PERIOD_LENGTH === 0) return gameweek / MERIT_PERIOD_LENGTH;
    return null;
}

/** Every gameweek belonging to a period. Periods 1-9 hold four; period 10 holds GW37-38. */
export function gameweeksInPeriod(periodIndex: number): number[] {
    if (!Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > MERIT_PERIOD_COUNT) {
        throw new Error(`Invalid merit period index: ${periodIndex}`);
    }
    if (periodIndex === MERIT_PERIOD_COUNT) return [37, 38];
    const end = periodIndex * MERIT_PERIOD_LENGTH;
    return Array.from({ length: MERIT_PERIOD_LENGTH }, (_, i) => end - MERIT_PERIOD_LENGTH + 1 + i);
}

/**
 * What one club earns for a period. Returns an exact value; the caller is
 * responsible for flooring before writing to the INT faab_budget column.
 * With the default rates the result is always a whole number already.
 */
export function computeMeritPayment(record: TeamRecord, rates: MeritRates): number {
    const raw =
        record.wins * rates.win +
        record.draws * rates.draw +
        record.losses * rates.loss +
        record.byes * rates.bye;
    // Guard against float dust from configured rates like 1.2 or 0.4.
    return Number(raw.toFixed(2));
}

/**
 * Turn completed matchup rows into a per-team record for one period.
 *
 * A team with no completed matchup in a gameweek is credited a BYE rather than
 * a loss. That covers both the odd-league virtual bye and the case where a
 * gameweek's matchups have not resolved — paying a bye is the conservative
 * choice, since charging a loss would penalise a club for a scheduling artefact.
 */
export function tallyPeriodRecords(
    rows: MatchupResultRow[],
    teamIds: string[],
    gameweeks: number[],
): Map<string, TeamRecord> {
    const gwSet = new Set(gameweeks);
    const tally = new Map<string, TeamRecord>();
    for (const id of teamIds) tally.set(id, { wins: 0, draws: 0, losses: 0, byes: 0 });

    // Track which (team, gameweek) pairs had a real fixture, so the rest are byes.
    const played = new Set<string>();

    for (const row of rows) {
        if (!gwSet.has(row.gameweek)) continue;
        if (row.status !== 'completed') continue;

        for (const teamId of [row.team_a_id, row.team_b_id]) {
            const rec = tally.get(teamId);
            if (!rec) continue; // not a team we were asked about
            played.add(`${teamId}:${row.gameweek}`);
            if (row.winner_team_id === null) rec.draws++;
            else if (row.winner_team_id === teamId) rec.wins++;
            else rec.losses++;
        }
    }

    for (const id of teamIds) {
        const rec = tally.get(id)!;
        for (const gw of gameweeks) {
            if (!played.has(`${id}:${gw}`)) rec.byes++;
        }
    }

    return tally;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test src/lib/economy`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/economy/meritPayments.ts src/lib/economy/__tests__/meritPayments.test.ts
git commit -m "feat(economy): add merit payment period and payout arithmetic"
```

---

## Task 3: Merit payments table and credit RPC

**Files:**
- Create: `supabase/migrations/092_merit_payments.sql`

**Interfaces:**
- Consumes: `leagues.merit_win` / `merit_draw` / `merit_loss` / `merit_bye` from Task 1.
- Produces: table `public.merit_payments`; enum value `merit_payment` on `transaction_type`; RPC `public.credit_merit_payment(p_league_id UUID, p_team_id UUID, p_season TEXT, p_period_index INT, p_amount INT, p_notes TEXT) RETURNS JSONB` returning `{ success: boolean, credited: boolean, error?: text }`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/092_merit_payments.sql`:

```sql
-- ============================================================
-- Migration 092: Monthly merit payments
-- ============================================================
-- Pays the regular-season pool during the season on match results, in ten
-- instalments (GW4/8/.../36, plus GW37-38), instead of as a lump sum at the
-- offseason reset.
--
-- Idempotency is enforced by the DATABASE, not by caller discipline.
-- prizeDistribution.ts documents itself as "idempotent in spirit but NOT
-- strictly protected from double-pays" because it keys on a matched notes
-- string; a merit payment fires from gameweek resolution, which can legitimately
-- re-run, so it needs a real unique constraint.

-- ── 1. Extend transaction_type ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'merit_payment'
      AND enumtypid = 'public.transaction_type'::regtype
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'merit_payment';
  END IF;
END $$;

-- ── 2. The ledger of what has been paid ─────────────────────
CREATE TABLE IF NOT EXISTS public.merit_payments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season       TEXT NOT NULL,
  period_index INT  NOT NULL CHECK (period_index BETWEEN 1 AND 10),
  amount       INT  NOT NULL,
  wins         INT  NOT NULL DEFAULT 0,
  draws        INT  NOT NULL DEFAULT 0,
  losses       INT  NOT NULL DEFAULT 0,
  byes         INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The whole point of this table: one payment per club per period per season.
  CONSTRAINT merit_payments_unique_period
    UNIQUE (league_id, team_id, season, period_index)
);

CREATE INDEX IF NOT EXISTS idx_merit_payments_league_season
  ON public.merit_payments(league_id, season);

ALTER TABLE public.merit_payments ENABLE ROW LEVEL SECURITY;

-- Managers may read their own league's merit history; only the service role
-- (used by cron/admin paths) writes, via the RPC below.
DROP POLICY IF EXISTS merit_payments_select_own_league ON public.merit_payments;
CREATE POLICY merit_payments_select_own_league ON public.merit_payments
  FOR SELECT USING (
    league_id IN (
      SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
    )
  );

-- ── 3. The credit RPC ───────────────────────────────────────
-- Atomic: the merit_payments row, the balance update and the transactions row
-- all commit together, so a crash cannot leave a paid balance with no record
-- (or a record with no payment).
CREATE OR REPLACE FUNCTION public.credit_merit_payment(
  p_league_id    UUID,
  p_team_id      UUID,
  p_season       TEXT,
  p_period_index INT,
  p_amount       INT,
  p_notes        TEXT,
  p_wins         INT DEFAULT 0,
  p_draws        INT DEFAULT 0,
  p_losses       INT DEFAULT 0,
  p_byes         INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'credited', false,
                              'error', 'Merit payment cannot be negative');
  END IF;

  -- Claim the period first. ON CONFLICT DO NOTHING makes a re-run a no-op
  -- rather than a double-pay, and reports which happened.
  INSERT INTO public.merit_payments (
    league_id, team_id, season, period_index, amount, wins, draws, losses, byes
  ) VALUES (
    p_league_id, p_team_id, p_season, p_period_index, p_amount,
    p_wins, p_draws, p_losses, p_byes
  )
  ON CONFLICT (league_id, team_id, season, period_index) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'credited', false,
                              'error', 'Period already paid');
  END IF;

  -- A zero payment is legal (a winless short period can still be zero if a
  -- league configures loss = 0), and the claim row above still records it.
  IF p_amount > 0 THEN
    UPDATE public.teams
    SET faab_budget = faab_budget + p_amount,
        updated_at  = NOW()
    WHERE id = p_team_id;

    INSERT INTO public.transactions (
      league_id, team_id, type, faab_bid, notes, processed_at, created_at
    ) VALUES (
      p_league_id, p_team_id, 'merit_payment', p_amount, p_notes, NOW(), NOW()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'credited', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_merit_payment(uuid, uuid, text, int, int, text, int, int, int, int)
  FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Verify the SQL parses**

There is no local Postgres, so this cannot be executed here. Instead read the file back and check three things by eye:
- Every `$$` is paired.
- The `UNIQUE` constraint column list exactly matches the `ON CONFLICT` column list.
- The `REVOKE` signature matches the `CREATE FUNCTION` parameter types in order (`uuid, uuid, text, int, int, text, int, int, int, int`).

A mismatch in the third is silent: the function is created but stays executable by `authenticated`.

- [ ] **Step 3: Hand the migration to the user with a verification script**

Tell the user to run `092_merit_payments.sql` in the Supabase SQL editor, then this check — it proves both the happy path and the idempotency guard:

```sql
-- Pick any real team, then dry-run the RPC twice.
WITH t AS (SELECT id, league_id FROM public.teams LIMIT 1)
SELECT public.credit_merit_payment(
  (SELECT league_id FROM t), (SELECT id FROM t),
  'TEST-SEASON', 1, 7, 'Merit test — safe to delete'
) AS first_call;

WITH t AS (SELECT id, league_id FROM public.teams LIMIT 1)
SELECT public.credit_merit_payment(
  (SELECT league_id FROM t), (SELECT id FROM t),
  'TEST-SEASON', 1, 7, 'Merit test — safe to delete'
) AS second_call;
```

Expected: `first_call` = `{"success": true, "credited": true}`, `second_call` = `{"success": true, "credited": false, "error": "Period already paid"}`.

Cleanup, which must also reverse the balance the first call credited:

```sql
UPDATE public.teams SET faab_budget = faab_budget - 7
WHERE id = (SELECT team_id FROM public.merit_payments WHERE season = 'TEST-SEASON');
DELETE FROM public.transactions WHERE notes = 'Merit test — safe to delete';
DELETE FROM public.merit_payments WHERE season = 'TEST-SEASON';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/092_merit_payments.sql
git commit -m "feat(economy): add merit_payments table and idempotent credit RPC"
```

---

## Task 4: Pay merit periods at gameweek resolution

**Files:**
- Create: `src/lib/economy/payMeritPeriod.ts`
- Modify: `src/lib/scoring/matchupProcessor.ts` (inside the `if (finished && leagueSummaryData.size > 0)` per-league loop, around line 281)

**Interfaces:**
- Consumes: everything from Task 2; `credit_merit_payment` from Task 3; `leagues.merit_*` from Task 1.
- Produces: `payMeritPeriod(admin: SupabaseClient, leagueId: string, gameweek: number): Promise<MeritPeriodResult>` where `interface MeritPeriodResult { paid: boolean; periodIndex: number | null; payments: { teamId: string; teamName: string; amount: number }[] }`.

- [ ] **Step 1: Write the orchestration module**

Create `src/lib/economy/payMeritPeriod.ts`:

```ts
/**
 * Gaffa — Merit period payout
 *
 * Called from the matchup processor when a gameweek finishes. If that gameweek
 * closes a merit period (GW4, 8, ... 36, 38) every club in the league is paid
 * for its results across that period.
 *
 * Deliberately hooked into gameweek resolution rather than a new cron route:
 * vercel.json does not schedule every /api/cron/* route (process-auctions,
 * process-loans and others are triggered externally), so a payment on its own
 * schedule could silently never fire. Tying it to the resolution it depends on
 * means it cannot drift.
 *
 * Safe to call for every finished gameweek — non-boundary gameweeks return
 * immediately, and the credit RPC rejects a period that has already been paid.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
    DEFAULT_MERIT_RATES,
    computeMeritPayment,
    gameweeksInPeriod,
    periodIndexForGameweek,
    tallyPeriodRecords,
} from './meritPayments';
import type { MatchupResultRow, MeritRates } from './meritPayments';

export interface MeritPeriodResult {
    paid: boolean;
    periodIndex: number | null;
    payments: { teamId: string; teamName: string; amount: number }[];
}

export async function payMeritPeriod(
    admin: SupabaseClient,
    leagueId: string,
    gameweek: number,
): Promise<MeritPeriodResult> {
    const periodIndex = periodIndexForGameweek(gameweek);
    if (periodIndex === null) return { paid: false, periodIndex: null, payments: [] };

    const gameweeks = gameweeksInPeriod(periodIndex);

    const { data: league, error: leagueErr } = await admin
        .from('leagues')
        .select('current_season, season, merit_win, merit_draw, merit_loss, merit_bye')
        .eq('id', leagueId)
        .single();

    if (leagueErr || !league) {
        throw new Error(`payMeritPeriod: failed to load league ${leagueId}: ${leagueErr?.message}`);
    }

    // Never hardcode the season string; the league row is the resolved value.
    const season = league.current_season ?? league.season;
    if (!season) throw new Error(`payMeritPeriod: league ${leagueId} has no season`);

    // Fall back to code defaults if a column is null — a league created before
    // migration 091 was applied would otherwise pay nothing at all.
    const rates: MeritRates = {
        win: Number(league.merit_win ?? DEFAULT_MERIT_RATES.win),
        draw: Number(league.merit_draw ?? DEFAULT_MERIT_RATES.draw),
        loss: Number(league.merit_loss ?? DEFAULT_MERIT_RATES.loss),
        bye: Number(league.merit_bye ?? DEFAULT_MERIT_RATES.bye),
    };

    const { data: teams, error: teamsErr } = await admin
        .from('teams')
        .select('id, team_name')
        .eq('league_id', leagueId);

    if (teamsErr || !teams?.length) {
        throw new Error(`payMeritPeriod: no teams for league ${leagueId}: ${teamsErr?.message}`);
    }

    const { data: matchups, error: matchupsErr } = await admin
        .from('matchups')
        .select('gameweek, team_a_id, team_b_id, winner_team_id, status')
        .eq('league_id', leagueId)
        .in('gameweek', gameweeks);

    if (matchupsErr) {
        throw new Error(`payMeritPeriod: failed to load matchups: ${matchupsErr.message}`);
    }

    const teamIds = teams.map((t) => t.id);
    const nameById = new Map(teams.map((t) => [t.id, t.team_name as string]));
    const records = tallyPeriodRecords((matchups ?? []) as MatchupResultRow[], teamIds, gameweeks);

    const payments: MeritPeriodResult['payments'] = [];
    const label = periodIndex === 10 ? 'GW37–38' : `GW${gameweeks[0]}–${gameweeks[3]}`;

    for (const teamId of teamIds) {
        const record = records.get(teamId)!;
        // faab_budget is INT. Floor here; the remainder is not paid.
        const amount = Math.floor(computeMeritPayment(record, rates));

        const { data: res, error } = await admin.rpc('credit_merit_payment', {
            p_league_id: leagueId,
            p_team_id: teamId,
            p_season: season,
            p_period_index: periodIndex,
            p_amount: amount,
            p_notes: `TV & Matchday Revenue — ${label} (${record.wins}W ${record.draws}D ${record.losses}L${record.byes > 0 ? ` ${record.byes}B` : ''})`,
            p_wins: record.wins,
            p_draws: record.draws,
            p_losses: record.losses,
            p_byes: record.byes,
        });

        if (error) {
            // One club failing must not abort the rest of the league's payout;
            // the unique constraint makes a later retry safe.
            console.error(`[payMeritPeriod] league ${leagueId} team ${teamId} failed:`, error.message);
            continue;
        }

        const credited = (res as { credited?: boolean } | null)?.credited;
        if (credited) {
            payments.push({ teamId, teamName: nameById.get(teamId) ?? 'Unknown', amount });
        }
    }

    return { paid: payments.length > 0, periodIndex, payments };
}
```

- [ ] **Step 2: Hook it into the matchup processor**

In `src/lib/scoring/matchupProcessor.ts`, add the import at the top alongside the existing `executeAdvanceTournament` import:

```ts
import { payMeritPeriod } from '@/lib/economy/payMeritPeriod';
```

Then find the per-league loop that begins around line 282:

```ts
    if (finished && leagueSummaryData.size > 0) {
        for (const [leagueId, summary] of Array.from(leagueSummaryData.entries())) {
            // A. Execute any pending drops queued during the gameweek
            try {
```

Insert a new block immediately after the `for (const [leagueId, summary] of ...)` line and **before** the `// A. Execute any pending drops` comment:

```ts
            // A0. Pay the merit period if this gameweek closes one.
            //
            // Runs before the deferred-transaction blocks below so a club that
            // is about to have a drop or trade executed already has the money.
            // Never fatal: the credit RPC is idempotent on
            // (league, team, season, period), so a failure here is retried the
            // next time this gameweek is resolved rather than double-paying.
            try {
                const merit = await payMeritPeriod(admin, leagueId, gameweek);
                if (merit.paid) {
                    console.log(
                        `[matchupProcessor] Merit period ${merit.periodIndex} paid for league ${leagueId}: ` +
                        merit.payments.map((p) => `${p.teamName} €${p.amount}m`).join(', ')
                    );
                }
            } catch (err) {
                console.error(`[matchupProcessor] Merit payment failed for league ${leagueId}:`, err);
            }

```

- [ ] **Step 3: Confirm `gameweek` and `admin` are in scope at the insertion point**

Run: `grep -n "export async function processMatchupsForGameweek" src/lib/scoring/matchupProcessor.ts`
Expected: the signature is `processMatchupsForGameweek(gameweek: number, finished: boolean)`, so `gameweek` is a parameter and in scope.

Run: `grep -n "const admin" src/lib/scoring/matchupProcessor.ts | head -2`
Expected: an `admin` client is created near the top of the function. If it is named differently, use that name.

- [ ] **Step 4: Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output. If it complains that `merit_win` does not exist on the `leagues` row type, the project has no generated DB types (queries are untyped through the Supabase client) — in that case the error indicates a real typo, so re-read the select string.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS. Task 2's tests still pass; nothing here changes their inputs.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/economy/payMeritPeriod.ts src/lib/scoring/matchupProcessor.ts
git commit -m "feat(economy): pay monthly merit income at gameweek resolution"
```

---

## Task 5: Placement curve and cup prize rebalance

**Files:**
- Modify: `src/lib/offseason/prizeDistribution.ts:29-47`
- Create: `src/lib/offseason/__tests__/prizeDistribution.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeSeasonPrize(rank: number, totalTeams: number): number` unchanged in signature, new endpoints; `DEFAULT_PRIZE_CONFIG` with rebalanced cup values; new exported constants `SEASON_PRIZE_FIRST = 40` and `SEASON_PRIZE_LAST = 20`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/offseason/__tests__/prizeDistribution.test.ts`:

```ts
/**
 * Gaffa — end-of-season placement curve
 *
 * The regular-season pool moved to monthly merit payments, so what remains at
 * the reset is mostly central revenue with a modest tilt. These tests pin the
 * endpoints and the ratio, because a steeper curve compounds in a dynasty
 * league where money never resets: at 5:1 the champion out-earns the bottom
 * club by EUR 74m a year, which is EUR 370m of divergence over five seasons.
 */

import { describe, it, expect } from 'vitest';
import {
    computeSeasonPrize,
    DEFAULT_PRIZE_CONFIG,
    SEASON_PRIZE_FIRST,
    SEASON_PRIZE_LAST,
} from '../prizeDistribution';

describe('computeSeasonPrize', () => {
    it('pays the first-place amount to rank 1 at any league size', () => {
        for (const n of [4, 6, 8, 10, 12]) {
            expect(computeSeasonPrize(1, n)).toBe(SEASON_PRIZE_FIRST);
        }
    });

    it('pays the last-place amount to the final rank at any league size', () => {
        for (const n of [4, 6, 8, 10, 12]) {
            expect(computeSeasonPrize(n, n)).toBe(SEASON_PRIZE_LAST);
        }
    });

    it('holds a 2:1 ratio between first and last', () => {
        expect(SEASON_PRIZE_FIRST / SEASON_PRIZE_LAST).toBe(2);
    });

    it('decreases monotonically down the table', () => {
        for (const n of [6, 8, 10]) {
            for (let rank = 2; rank <= n; rank++) {
                expect(computeSeasonPrize(rank, n)).toBeLessThanOrEqual(computeSeasonPrize(rank - 1, n));
            }
        }
    });

    it('matches the documented 6-team curve', () => {
        const curve = [1, 2, 3, 4, 5, 6].map((r) => computeSeasonPrize(r, 6));
        expect(curve).toEqual([40, 35, 30, 26, 23, 20]);
    });

    it('returns whole millions, since faab_budget is an INT column', () => {
        for (const n of [4, 6, 8, 10]) {
            for (let rank = 1; rank <= n; rank++) {
                expect(Number.isInteger(computeSeasonPrize(rank, n))).toBe(true);
            }
        }
    });

    it('handles a one-team league without dividing by zero', () => {
        expect(computeSeasonPrize(1, 1)).toBe(SEASON_PRIZE_FIRST);
    });
});

describe('DEFAULT_PRIZE_CONFIG', () => {
    // The old config paid consolation_cup_winner: 60, identical to the
    // Champions Cup, so in an 8-team league the 7th-placed club could earn
    // EUR 60m for winning one game against 8th.
    it('never pays a lesser cup more than the Champions Cup', () => {
        expect(DEFAULT_PRIZE_CONFIG.league_cup_winner)
            .toBeLessThan(DEFAULT_PRIZE_CONFIG.champions_cup_winner);
        expect(DEFAULT_PRIZE_CONFIG.consolation_cup_winner)
            .toBeLessThan(DEFAULT_PRIZE_CONFIG.champions_cup_winner);
    });

    it('never pays a runner-up more than that cup’s winner', () => {
        const pairs: [string, string][] = [
            ['champions_cup_winner', 'champions_cup_runner_up'],
            ['league_cup_winner', 'league_cup_runner_up'],
            ['consolation_cup_winner', 'consolation_cup_runner_up'],
        ];
        for (const [winner, runnerUp] of pairs) {
            expect(DEFAULT_PRIZE_CONFIG[runnerUp]).toBeLessThan(DEFAULT_PRIZE_CONFIG[winner]);
        }
    });

    it('never pays a cup winner more than finishing first in the league', () => {
        for (const value of Object.values(DEFAULT_PRIZE_CONFIG)) {
            expect(value).toBeLessThanOrEqual(SEASON_PRIZE_FIRST);
        }
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test src/lib/offseason`
Expected: FAIL — `SEASON_PRIZE_FIRST` is not exported, and the 6-team curve assertion returns `[85, 76, 69, 62, 56, 50]`.

- [ ] **Step 3: Update the prize module**

In `src/lib/offseason/prizeDistribution.ts`, replace the block from `export const DEFAULT_PRIZE_CONFIG` through the end of `computeSeasonPrize` (lines 24–47) with:

```ts
/**
 * Cup prize defaults — season standing prizes are computed dynamically
 * via computeSeasonPrize() and are not stored here.
 * Per-league overrides for any key (including season_Nth) live in leagues.prize_config.
 *
 * Rebalanced by the 2026-07 economy pass. The previous config paid
 * consolation_cup_winner: 60 — identical to the Champions Cup — so in an
 * 8-team league the 7th-placed club could earn EUR 60m for winning a single
 * game against 8th, out-earning most of the table. Consolation is now level
 * with the League Cup, and no cup pays more than finishing first.
 */
export const DEFAULT_PRIZE_CONFIG: PrizeConfig = {
  champions_cup_winner: 40,
  champions_cup_runner_up: 15,
  league_cup_winner: 20,
  league_cup_runner_up: 8,
  consolation_cup_winner: 20,
  consolation_cup_runner_up: 8,
};

/**
 * Endpoints of the end-of-season placement curve, in EUR m.
 *
 * These used to be 85 and 50, when this pool carried the entire merit load.
 * The merit component now arrives monthly during the season (see
 * src/lib/economy/meritPayments.ts), so what is left at the reset is mostly
 * central revenue with a modest tilt — hence a 2:1 ratio rather than
 * something steeper.
 *
 * Why not steeper: monthly merit already pays a champion ~EUR 75m against a
 * bottom club's ~EUR 41m. Stacking a 5:1 placement curve on top produces a
 * EUR 74m gap in total annual earnings, which compounds to EUR 370m over five
 * seasons in a league where money never resets. The Premier League's own
 * central distribution is mostly an equal share for the same reason; prestige
 * differentiation is carried by the cups, which are uncorrelated with league
 * position.
 */
export const SEASON_PRIZE_FIRST = 40;
export const SEASON_PRIZE_LAST = 20;

/**
 * Exponential prize curve for regular season standings.
 * Always returns SEASON_PRIZE_FIRST for 1st and SEASON_PRIZE_LAST for last,
 * regardless of league size.
 * Formula: FIRST × (LAST/FIRST)^((rank−1)/(N−1)), rounded to nearest integer.
 */
export function computeSeasonPrize(rank: number, totalTeams: number): number {
  if (totalTeams <= 1) return SEASON_PRIZE_FIRST;
  const t = (rank - 1) / (totalTeams - 1);
  return Math.round(SEASON_PRIZE_FIRST * Math.pow(SEASON_PRIZE_LAST / SEASON_PRIZE_FIRST, t));
}
```

Also update the module docblock at the top of the file: replace `- Regular season standings (exponential curve: €85m 1st → €50m last, N-team agnostic)` with `- Regular season standings (exponential curve: €40m 1st → €20m last, N-team agnostic)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test src/lib/offseason`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && node node_modules/typescript/bin/tsc --noEmit`
Expected: all tests PASS, no typecheck output.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/offseason/prizeDistribution.ts src/lib/offseason/__tests__/prizeDistribution.test.ts
git commit -m "feat(economy): flatten placement curve to 40->20 and rebalance cup prizes"
```

---

## Task 6: Solidarity split pure arithmetic

**Files:**
- Create: `src/lib/economy/solidarity.ts`
- Create: `src/lib/economy/__tests__/solidarity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_SOLIDARITY_SHARE = 0.20`, `DEFAULT_SCOUT_SHARE = 0.50`
  - `interface SolidarityRates { share: number; scoutShare: number }`
  - `interface SolidarityDistribution { pool: number; scout: number; perOtherClub: number; otherClubCount: number; burned: number }`
  - `computeSolidarity(amount: number, totalClubs: number, hasScout: boolean, rates?: SolidarityRates): SolidarityDistribution`

This module is the reference implementation. Task 7 reimplements the same arithmetic in PL/pgSQL because the money must move atomically inside the resolver; these tests are what keep the two in agreement, so any change here must be mirrored in the SQL.

> **Do not "clean this up" as dead code.** `computeSolidarity` is deliberately never called from production TypeScript — the live path is the SQL in Tasks 7 and 8. It exists so the arithmetic has an executable specification with tests, which is the only automated check on the RPCs in a repo with no database test harness. The docblock says so; keep it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/economy/__tests__/solidarity.test.ts`:

```ts
/**
 * Gaffa — transfer recirculation arithmetic
 *
 * A winning free-agent bid used to be deducted from the winner and credited to
 * nobody, so every large signing permanently removed money from the league.
 * These tests pin the split that returns part of it: a Scout's Fee to whoever
 * opened the auction, an equal share to the other non-winners, and the rest
 * burned so a genuine drain survives.
 *
 * IMPORTANT: teams.faab_budget is an INT column, so every figure here is a
 * whole number of millions and the remainder burns. That is why the field
 * receives EUR 2m each on a EUR 90m bid rather than the EUR 2.25m an
 * unrounded split would give.
 */

import { describe, it, expect } from 'vitest';
import {
    computeSolidarity,
    DEFAULT_SOLIDARITY_SHARE,
    DEFAULT_SCOUT_SHARE,
} from '../solidarity';

describe('computeSolidarity', () => {
    it('gives the scout 10% of the bid at default rates', () => {
        const d = computeSolidarity(90, 6, true);
        expect(d.pool).toBe(18);
        expect(d.scout).toBe(9);
    });

    it('splits the remainder equally among the other non-winning clubs', () => {
        const d = computeSolidarity(90, 6, true);
        // 6 clubs: winner and scout are excluded, leaving 4.
        expect(d.otherClubCount).toBe(4);
        expect(d.perOtherClub).toBe(2); // floor(9 / 4)
    });

    it('never distributes more than the original amount', () => {
        for (const amount of [1, 7, 20, 40, 60, 90, 150, 220]) {
            for (const clubs of [4, 6, 8, 10]) {
                for (const hasScout of [true, false]) {
                    const d = computeSolidarity(amount, clubs, hasScout);
                    const handedOut = d.scout + d.perOtherClub * d.otherClubCount;
                    expect(handedOut).toBeLessThanOrEqual(amount);
                    expect(d.burned).toBe(amount - handedOut);
                    expect(d.burned).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it('pays every amount as a whole number of millions', () => {
        for (const amount of [1, 3, 7, 13, 37, 91, 173]) {
            const d = computeSolidarity(amount, 7, true);
            expect(Number.isInteger(d.scout)).toBe(true);
            expect(Number.isInteger(d.perOtherClub)).toBe(true);
            expect(Number.isInteger(d.burned)).toBe(true);
        }
    });

    it('splits the whole pool among all other clubs when there is no scout', () => {
        const d = computeSolidarity(100, 6, false);
        expect(d.scout).toBe(0);
        expect(d.otherClubCount).toBe(5); // only the winner is excluded
        expect(d.perOtherClub).toBe(4);   // floor(20 / 5)
    });

    it('pays nothing when the amount is too small to floor above zero', () => {
        const d = computeSolidarity(4, 6, true);
        expect(d.pool).toBe(0);
        expect(d.scout).toBe(0);
        expect(d.perOtherClub).toBe(0);
        expect(d.burned).toBe(4);
    });

    it('handles a two-club league without dividing by zero', () => {
        const d = computeSolidarity(100, 2, true);
        // Winner + scout account for both clubs, so nobody is left to share.
        expect(d.otherClubCount).toBe(0);
        expect(d.perOtherClub).toBe(0);
        expect(d.scout).toBe(10);
        expect(d.burned).toBe(90);
    });

    it('rejects a negative amount', () => {
        expect(() => computeSolidarity(-5, 6, true)).toThrow();
    });

    it('uses the documented default rates', () => {
        expect(DEFAULT_SOLIDARITY_SHARE).toBe(0.20);
        expect(DEFAULT_SCOUT_SHARE).toBe(0.50);
    });

    it('honours per-league rate overrides', () => {
        const d = computeSolidarity(100, 6, true, { share: 0.10, scoutShare: 1.0 });
        expect(d.pool).toBe(10);
        expect(d.scout).toBe(10);
        expect(d.perOtherClub).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test src/lib/economy/__tests__/solidarity.test.ts`
Expected: FAIL — `Failed to resolve import "../solidarity"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/economy/solidarity.ts`:

```ts
/**
 * Gaffa — Transfer Recirculation (Solidarity + Scout's Fee)
 *
 * A winning free-agent bid, a drop severance fee and the loan slot buyback
 * were all previously destroyed outright — migration 060 comments the buyback
 * as "Deduct and burn fee". That made every large signing remove liquidity
 * from the league permanently, which is why a big transfer felt unrecoverable:
 * your squad is only sellable if somebody else still holds cash.
 *
 * This splits a share of the burned amount back into the league:
 *   - `share` of the amount forms a pool (default 20%).
 *   - `scoutShare` of that pool goes to the auction initiator (default 50%),
 *     so the scout receives 10% of the bid, uncapped.
 *   - The rest of the pool is split equally among the other non-winners.
 *   - Everything left burns, so a genuine drain survives.
 *
 * Football does this twice over: FIFA's solidarity mechanism distributes a
 * slice of every transfer fee to a player's former clubs, and the Premier
 * League's central pot is largely an equal share.
 *
 * Why 20% and not more: after this change free-agent bids are the ONLY
 * remaining sink, so `share` sets the league-wide signing spend needed to
 * break even — EUR 149m per team at 20%, EUR 178m at 33%, which no realistic
 * season reaches. 20% is close to the ceiling.
 *
 * This is the reference implementation. Migration 091 reimplements the same
 * arithmetic in PL/pgSQL, because the money must move atomically inside the
 * auction resolver. The tests beside this file are what keep the two honest —
 * change one and you must change the other.
 *
 * Design doc: docs/superpowers/specs/2026-07-29-economy-rebalance-design.md
 */

/** Fraction of a burned amount that returns to the league. */
export const DEFAULT_SOLIDARITY_SHARE = 0.20;

/** Fraction OF THE POOL paid to the auction initiator. */
export const DEFAULT_SCOUT_SHARE = 0.50;

export interface SolidarityRates {
    share: number;
    scoutShare: number;
}

export interface SolidarityDistribution {
    /** Total returned to the league, before splitting. */
    pool: number;
    /** Paid to the auction initiator. Zero when there is no eligible scout. */
    scout: number;
    /** Paid to EACH of the other non-winning clubs. */
    perOtherClub: number;
    /** How many clubs receive `perOtherClub`. */
    otherClubCount: number;
    /** Destroyed: the un-recirculated share plus any rounding remainder. */
    burned: number;
}

/**
 * @param amount      The sum being taken from a club (winning bid, severance, buyback fee).
 * @param totalClubs  Number of clubs in the league, including the payer.
 * @param hasScout    True when an auction initiator exists AND is not the winner.
 *                    A Buy Now with no prior manager bid, or an auction the
 *                    initiator went on to win, both pass false.
 */
export function computeSolidarity(
    amount: number,
    totalClubs: number,
    hasScout: boolean,
    rates: SolidarityRates = { share: DEFAULT_SOLIDARITY_SHARE, scoutShare: DEFAULT_SCOUT_SHARE },
): SolidarityDistribution {
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`computeSolidarity: amount must be >= 0, got ${amount}`);
    }

    const pool = Math.floor(amount * rates.share);
    const scout = hasScout ? Math.floor(pool * rates.scoutShare) : 0;

    // The payer is always excluded. The scout, when there is one, is paid
    // separately and so is excluded from the equal split too.
    const otherClubCount = Math.max(0, totalClubs - (hasScout ? 2 : 1));
    const perOtherClub = otherClubCount > 0 ? Math.floor((pool - scout) / otherClubCount) : 0;

    const handedOut = scout + perOtherClub * otherClubCount;
    return { pool, scout, perOtherClub, otherClubCount, burned: amount - handedOut };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test src/lib/economy/__tests__/solidarity.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/economy/solidarity.ts src/lib/economy/__tests__/solidarity.test.ts
git commit -m "feat(economy): add transfer recirculation split arithmetic"
```

---

## Task 7: Solidarity in the auction resolver, replacing the rebate

The largest and riskiest task. `resolve_single_player_auction_rpc` is ~350 lines and handles drops, severance, academy routing and notifications. **Do not rewrite it from scratch.** Copy migration 062's function body verbatim and replace exactly one block.

**Files:**
- Create: `supabase/migrations/093_solidarity_on_auctions.sql`
- Reference: `supabase/migrations/062_severance_rate_update.sql` (source to copy)

**Interfaces:**
- Consumes: `leagues.solidarity_share`, `leagues.scout_share` from Task 1; the arithmetic defined in Task 6.
- Produces: enum value `solidarity_payment` on `transaction_type`; `resolve_single_player_auction_rpc` returning the same JSONB shape as before, with `rebate_amount` and `rebate_team_id` replaced by `scout_amount`, `scout_team_id`, `solidarity_per_club` and `solidarity_club_count`.

- [ ] **Step 1: Note the callers that read the return shape**

Run: `grep -rn "rebate_amount\|rebate_team_id" src/`
Expected: hits in `src/app/api/cron/process-auctions/route.ts` and `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`. Write down every line — Step 5 updates them, and missing one leaves a notification that silently never sends.

- [ ] **Step 2: Create the migration by copying 062**

```bash
cp supabase/migrations/062_severance_rate_update.sql supabase/migrations/093_solidarity_on_auctions.sql
```

- [ ] **Step 3: Replace the header comment**

In `093_solidarity_on_auctions.sql`, replace the leading comment block (the first 5 lines, from `-- ====` through the line ending `instead of 10%.`) with:

```sql
-- ============================================================
-- Migration 093: Recirculate auction money (Solidarity + Scout's Fee)
-- ============================================================
-- Supersedes 062. The severance rate (20% of market value, EUR 2m floor) is
-- unchanged; what changes is where the money goes.
--
-- Previously the winning bid was deducted and credited to nobody, and the
-- auction initiator received a rebate of LEAST(FLOOR(bid * 0.2), 5) — capped
-- at EUR 5m, which made it worthless on exactly the deals where scouting
-- mattered most. Surfacing a EUR 150m signing paid the same as a EUR 25m one.
--
-- Now `solidarity_share` of the winning bid (default 20%) returns to the
-- league: `scout_share` of that pool (default 50%) to the initiator, so the
-- scout earns 10% of the bid uncapped, and the rest split equally among the
-- other non-winning clubs. The remainder burns, preserving a real drain.
--
-- Reference implementation and tests: src/lib/economy/solidarity.ts.
-- Any change to the arithmetic here must be mirrored there.
--
-- All amounts are whole millions: teams.faab_budget is INT, so each step
-- FLOORs and the remainder burns.
```

- [ ] **Step 4: Replace the rebate block with the solidarity block**

First, extend the enum. Insert this immediately **before** the `CREATE OR REPLACE FUNCTION` line:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'solidarity_payment'
      AND enumtypid = 'public.transaction_type'::regtype
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'solidarity_payment';
  END IF;
END $$;

```

Next, in the `DECLARE` block, replace these two lines:

```sql
  v_rebate_amount INT := 0;
  v_rebate_team_id UUID := NULL;
```

with:

```sql
  v_solidarity_share NUMERIC := 0.20;
  v_scout_share NUMERIC := 0.50;
  v_pool INT := 0;
  v_scout_amount INT := 0;
  v_scout_team_id UUID := NULL;
  v_total_clubs INT := 0;
  v_other_club_count INT := 0;
  v_solidarity_per_club INT := 0;
  v_has_scout BOOLEAN := FALSE;
  s RECORD;
```

Then, in step 1 of the function body, extend the league settings read. Replace:

```sql
  SELECT roster_size, taxi_size, taxi_age_limit
  INTO v_roster_size, v_academy_size, v_academy_age_limit
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;
```

with:

```sql
  SELECT roster_size, taxi_size, taxi_age_limit, solidarity_share, scout_share
  INTO v_roster_size, v_academy_size, v_academy_age_limit, v_solidarity_share, v_scout_share
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;
```

And immediately after the three existing `COALESCE` defaults, add:

```sql
  v_solidarity_share := COALESCE(v_solidarity_share, 0.20);
  v_scout_share := COALESCE(v_scout_share, 0.50);
```

Now replace the entire rebate section. Find the block that starts with the comment `-- 5. Calculate and award Scout's Rebate (Finder's Fee)` and ends with the `END IF;` that closes `IF FOUND AND v_initiator_team_id IS NOT NULL ...`. Replace **all of it** with:

```sql
    -- 5. Recirculate part of the winning bid (Scout's Fee + Solidarity)
    --
    -- The initiator is the earliest MANAGER bid on this player (team_id IS NOT
    -- NULL excludes the system-seeded anchor row). No initiator, or an
    -- initiator who went on to win, means no Scout's Fee — the whole pool then
    -- splits equally among the other clubs. A Buy Now with no prior manager
    -- bid takes that same path.
    SELECT wc.team_id, t.team_name, t.user_id
    INTO v_initiator_team_id, v_initiator_team_name, v_initiator_user_id
    FROM public.waiver_claims wc
    JOIN public.teams t ON t.id = wc.team_id
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.is_auction = TRUE
      AND wc.team_id IS NOT NULL
    ORDER BY wc.created_at ASC
    LIMIT 1;

    v_has_scout := (v_initiator_team_id IS NOT NULL AND v_initiator_team_id <> v_winner_team_id);

    SELECT COUNT(1) INTO v_total_clubs FROM public.teams WHERE league_id = p_league_id;

    v_pool := FLOOR(v_winner_bid * v_solidarity_share);
    IF v_has_scout THEN
      v_scout_amount := FLOOR(v_pool * v_scout_share);
      v_other_club_count := GREATEST(0, v_total_clubs - 2);
    ELSE
      v_scout_amount := 0;
      v_other_club_count := GREATEST(0, v_total_clubs - 1);
    END IF;

    IF v_other_club_count > 0 THEN
      v_solidarity_per_club := FLOOR((v_pool - v_scout_amount) / v_other_club_count);
    ELSE
      v_solidarity_per_club := 0;
    END IF;

    -- Pay the scout.
    IF v_has_scout AND v_scout_amount > 0 THEN
      v_scout_team_id := v_initiator_team_id;

      UPDATE public.teams
      SET faab_budget = faab_budget + v_scout_amount,
          updated_at = NOW()
      WHERE id = v_scout_team_id;

      INSERT INTO public.transactions (
        league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
      ) VALUES (
        p_league_id,
        v_scout_team_id,
        p_player_id,
        'rebate',
        v_scout_amount,
        'Scout''s fee: opened the auction for ' || v_player_name ||
          ' (10% of the €' || v_winner_bid || 'm winning bid)',
        NOW(),
        NOW()
      );
    END IF;

    -- Pay every other club its equal share. Excludes the winner always, and
    -- the scout when one was paid above.
    IF v_solidarity_per_club > 0 THEN
      FOR s IN
        SELECT id FROM public.teams
        WHERE league_id = p_league_id
          AND id <> v_winner_team_id
          AND (NOT v_has_scout OR id <> v_initiator_team_id)
      LOOP
        UPDATE public.teams
        SET faab_budget = faab_budget + v_solidarity_per_club,
            updated_at = NOW()
        WHERE id = s.id;

        INSERT INTO public.transactions (
          league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
        ) VALUES (
          p_league_id,
          s.id,
          p_player_id,
          'solidarity_payment',
          v_solidarity_per_club,
          'Solidarity payment from the €' || v_winner_bid || 'm signing of ' || v_player_name,
          NOW(),
          NOW()
        );
      END LOOP;
    END IF;
```

- [ ] **Step 5: Update the returned JSONB**

In the `v_result := jsonb_build_object(...)` call, replace these two entries:

```sql
      'rebate_amount', v_rebate_amount,
      'rebate_team_id', v_rebate_team_id,
```

with:

```sql
      'scout_amount', v_scout_amount,
      'scout_team_id', v_scout_team_id,
      'solidarity_per_club', v_solidarity_per_club,
      'solidarity_club_count', v_other_club_count,
```

Then update every TypeScript caller found in Step 1. In `src/app/api/cron/process-auctions/route.ts` and `src/app/api/leagues/[leagueId]/auctions/bid/route.ts`, rename the destructured/read fields `rebate_amount` → `scout_amount` and `rebate_team_id` → `scout_team_id`, and change any user-facing copy from "rebate" to "Scout's fee". Do not leave a stale `rebate_amount` read — it would silently evaluate to `undefined` and suppress the notification.

- [ ] **Step 6: Verify the SQL structurally**

Run: `grep -c "rebate_amount\|v_rebate" supabase/migrations/093_solidarity_on_auctions.sql`
Expected: `0`. Any hit means a declaration or reference was missed.

Run: `grep -n "REVOKE EXECUTE" supabase/migrations/093_solidarity_on_auctions.sql`
Expected: the `REVOKE` line copied from 062 is still present and its signature still reads `(uuid, uuid, int[])` — the function's parameters are unchanged, so it must not be edited.

- [ ] **Step 7: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes. If the build fails on an unused variable in a caller, remove the dead binding rather than suppressing the lint.

- [ ] **Step 8: Hand the migration to the user with a verification query**

Tell the user to run `093_solidarity_on_auctions.sql`, then verify the arithmetic against the reference table without moving real money:

```sql
-- Expected at defaults (share 0.20, scout 0.50), 6 clubs, with a scout:
--   bid  90 -> pool 18, scout 9, each other club 2
--   bid  40 -> pool  8, scout 4, each other club 1
--   bid  20 -> pool  4, scout 2, each other club 0
SELECT bid,
       FLOOR(bid * 0.20)                        AS pool,
       FLOOR(FLOOR(bid * 0.20) * 0.50)          AS scout,
       FLOOR((FLOOR(bid * 0.20) - FLOOR(FLOOR(bid * 0.20) * 0.50)) / 4) AS per_other_club
FROM (VALUES (20), (40), (60), (90), (150)) AS v(bid);
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/093_solidarity_on_auctions.sql \
        src/app/api/cron/process-auctions/route.ts \
        "src/app/api/leagues/[leagueId]/auctions/bid/route.ts"
git commit -m "feat(economy): recirculate auction bids as scout fee + solidarity, replacing capped rebate"
```

---

## Task 8: Solidarity on standalone drops and the loan slot buyback

**Files:**
- Create: `supabase/migrations/094_solidarity_on_drops_and_buyback.sql`
- Modify: `src/lib/roster/executeDrop.ts:86-91`

**Interfaces:**
- Consumes: `leagues.solidarity_share` from Task 1; the `solidarity_payment` enum value from Task 7.
- Produces: RPC `public.distribute_solidarity(p_league_id UUID, p_payer_team_id UUID, p_amount INT, p_reason TEXT) RETURNS JSONB` returning `{ success: boolean, pool: int, per_club: int, club_count: int }`.

There is no scout on a drop or a buyback — nobody opened an auction — so the whole pool splits equally among the other clubs. That is the same no-scout path as Task 7.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/094_solidarity_on_drops_and_buyback.sql`:

```sql
-- ============================================================
-- Migration 094: Solidarity on drop severance and slot buyback
-- ============================================================
-- Two more amounts were being destroyed outright: the 20% drop severance fee
-- (charged on plain drops via executeDrop.ts) and the loan slot buyback fee,
-- which migration 060 comments as "Deduct and burn fee".
--
-- Both now recirculate on the same terms as an auction bid, minus the Scout's
-- Fee — nobody opened an auction, so there is no scout, and the whole pool
-- splits equally among the other clubs.
--
-- Reference implementation: src/lib/economy/solidarity.ts, hasScout = false.

CREATE OR REPLACE FUNCTION public.distribute_solidarity(
  p_league_id     UUID,
  p_payer_team_id UUID,
  p_amount        INT,
  p_reason        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_share NUMERIC := 0.20;
  v_pool INT := 0;
  v_club_count INT := 0;
  v_per_club INT := 0;
  s RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'pool', 0, 'per_club', 0, 'club_count', 0);
  END IF;

  SELECT COALESCE(solidarity_share, 0.20) INTO v_share
  FROM public.leagues WHERE id = p_league_id;
  v_share := COALESCE(v_share, 0.20);

  -- faab_budget is INT: floor at every step, remainder burns.
  v_pool := FLOOR(p_amount * v_share);

  SELECT COUNT(1) INTO v_club_count
  FROM public.teams
  WHERE league_id = p_league_id AND id <> p_payer_team_id;

  IF v_club_count > 0 THEN
    v_per_club := FLOOR(v_pool / v_club_count);
  END IF;

  IF v_per_club > 0 THEN
    FOR s IN
      SELECT id FROM public.teams
      WHERE league_id = p_league_id AND id <> p_payer_team_id
    LOOP
      UPDATE public.teams
      SET faab_budget = faab_budget + v_per_club,
          updated_at = NOW()
      WHERE id = s.id;

      INSERT INTO public.transactions (
        league_id, team_id, type, faab_bid, notes, processed_at, created_at
      ) VALUES (
        p_league_id, s.id, 'solidarity_payment', v_per_club, p_reason, NOW(), NOW()
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'pool', v_pool, 'per_club', v_per_club, 'club_count', v_club_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.distribute_solidarity(uuid, uuid, int, text)
  FROM PUBLIC, anon, authenticated;

-- ── Wire it into the loan slot buyback ──────────────────────
-- 060's execute_loan_slot_buyback_rpc deducts the fee and logs it as burned.
-- Add the distribution immediately after the deduction. Replace the comment
-- "-- 4. Deduct and burn fee" with "-- 4. Deduct fee, recirculate a share",
-- and add a call to distribute_solidarity after the transactions INSERT.
--
-- NOTE FOR THE IMPLEMENTER: copy the full body of
-- execute_loan_slot_buyback_rpc from 060_player_loans.sql into this migration
-- as a CREATE OR REPLACE, then insert the single PERFORM line shown below
-- after its transactions INSERT. Do not attempt to ALTER a function body.
--
--   PERFORM public.distribute_solidarity(
--     p_league_id, v_lender_team_id, v_slot_buyback_fee,
--     'Solidarity payment from a loan slot buyback fee'
--   );
```

- [ ] **Step 2: Complete the buyback function in the migration**

Copy `supabase/migrations/060_player_loans.sql` **lines 492–559** verbatim — that is `CREATE OR REPLACE FUNCTION public.execute_loan_slot_buyback_rpc(` through its closing `$$;` — into `094_solidarity_on_drops_and_buyback.sql`, replacing the trailing comment block from Step 1.

Extract it mechanically rather than by hand:

```bash
sed -n '492,559p' supabase/migrations/060_player_loans.sql
```

Then append the original `REVOKE` line from `060_player_loans.sql:692`:

```sql
REVOKE EXECUTE ON FUNCTION public.execute_loan_slot_buyback_rpc(uuid, uuid) FROM PUBLIC, anon, authenticated;
```

Make exactly two edits to the copy:

1. Change the comment `-- 4. Deduct and burn fee` to `-- 4. Deduct fee, recirculate a share (migration 094)`.
2. Change the transaction note `'Paid slot buyback fee (burned)'` to `'Paid slot buyback fee'`, and immediately after that `INSERT INTO public.transactions ...` statement add:

```sql
  PERFORM public.distribute_solidarity(
    p_league_id, v_lender_team_id, v_slot_buyback_fee,
    'Solidarity payment from a loan slot buyback fee'
  );
```

Do not change the function's parameters, its `RETURN json_build_object('success', true, 'fee_paid', v_slot_buyback_fee)` shape, or the `REVOKE` signature — `slot-buyback/route.ts:89` reads `fee_paid` to build its announcement.

- [ ] **Step 3: Wire it into standalone drops**

In `src/lib/roster/executeDrop.ts`, find the severance deduction at lines 86–91:

```ts
    } else if (severanceFee > 0) {
        await admin
            .from('teams')
            .update({ faab_budget: Math.max(0, team.faab_budget - severanceFee) })
            .eq('id', teamId);
    }
```

Replace it with:

```ts
    } else if (severanceFee > 0) {
        // Math.max(0, ...) is deliberate: a club with no money still gets to
        // drop a player rather than being trapped with an unwanted roster.
        const charged = Math.min(severanceFee, team.faab_budget);
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget - charged })
            .eq('id', teamId);

        // Recirculate a share of what was actually charged, not of the nominal
        // fee — otherwise a broke club's drop would mint money for the league.
        // Never fatal: the drop itself has already committed, and a failed
        // distribution costs the other clubs a few million rather than
        // corrupting the roster.
        if (charged > 0) {
            const { error: solErr } = await admin.rpc('distribute_solidarity', {
                p_league_id: team.league_id,
                p_payer_team_id: teamId,
                p_amount: charged,
                p_reason: `Solidarity payment from ${player.name}'s severance fee`,
            });
            if (solErr) {
                console.error('[executeDrop] Solidarity distribution failed:', solErr.message);
            }
        }
    }
```

- [ ] **Step 4: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS. No test covers `executeDrop` directly; this confirms nothing else regressed.

- [ ] **Step 6: Hand the migration to the user**

Tell the user to run `094_solidarity_on_drops_and_buyback.sql`, then:

```sql
-- Dry-run the split for a EUR 10m severance in a 6-club league:
-- pool = FLOOR(10 * 0.20) = 2, per_club = FLOOR(2 / 5) = 0.
-- Small severances therefore recirculate nothing, which is intended.
SELECT FLOOR(10 * 0.20) AS pool, FLOOR(FLOOR(10 * 0.20) / 5) AS per_club;

-- Confirm the helper exists and is not publicly executable:
SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('distribute_solidarity', 'credit_merit_payment');
```

Expected: both functions listed, `authenticated_can_run` = `false` for each.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/094_solidarity_on_drops_and_buyback.sql src/lib/roster/executeDrop.ts
git commit -m "feat(economy): recirculate drop severance and loan slot buyback fees"
```

---

## Task 9: Finance page — new categories and a net-created readout

**Files:**
- Modify: `src/app/(dashboard)/league/[leagueId]/finance/page.tsx:61-87`

**Interfaces:**
- Consumes: the `merit_payment` and `solidarity_payment` transaction types from Tasks 3 and 7.
- Produces: `netCreated` and `netDestroyed` props passed to `FinanceClient`.

The `TX_DIRECTIONS` map is currently missing five existing transaction types — `sale_proceeds`, `loan_fee`, `loan_bonus`, `loan_recall_penalty` and `loan_slot_buyback` — so those amounts fall through to `undefined` and are counted as neither spent nor earned. Fix that here while adding the two new ones.

- [ ] **Step 1: Extend the direction map and compute the ledger**

In `src/app/(dashboard)/league/[leagueId]/finance/page.tsx`, replace lines 62–87 (from `let totalSpent = 0;` through `const startingBudget = ...`) with:

```ts
  let totalSpent = 0;
  let totalEarned = 0;

  // 'in' / 'out' drive this club's own spent-vs-earned totals.
  // Five types were previously absent from this map — sale_proceeds, loan_fee,
  // loan_bonus, loan_recall_penalty and loan_slot_buyback — so they resolved to
  // undefined and were silently counted as neither.
  const TX_DIRECTIONS: Record<string, 'in' | 'out' | 'none'> = {
    waiver_claim:          'out',
    free_agent_pickup:     'none',
    drop:                  'out',
    trade:                 'none',
    transfer_out:          'in',
    transfer_compensation: 'in',
    rebate:                'in',
    draft_pick:            'none',
    prize_payout:          'in',
    merit_payment:         'in',
    solidarity_payment:    'in',
    sale_proceeds:         'in',
    loan_fee:              'in',
    loan_bonus:            'out',
    loan_recall_penalty:   'out',
    loan_slot_buyback:     'out',
  };

  // Whether a movement changes the league's TOTAL money supply, as opposed to
  // moving it between clubs. This is the readout that tells you whether the
  // economy is inflating: if 'created' consistently exceeds 'destroyed',
  // balances drift upward every season and money loses meaning.
  //
  // Note this is per-club data, so it is one club's share of league-wide
  // creation, not the league total. Trades, sales, loan fees and solidarity
  // payments are all transfers between clubs, so none of them are counted.
  const TX_SUPPLY: Record<string, 'created' | 'destroyed' | 'neutral'> = {
    prize_payout:          'created',
    merit_payment:         'created',
    transfer_out:          'created',
    transfer_compensation: 'created',
    rebate:                'created',
    waiver_claim:          'destroyed',
    drop:                  'destroyed',
    loan_slot_buyback:     'destroyed',
  };

  let netCreated = 0;
  let netDestroyed = 0;

  for (const tx of txList) {
    const amount = tx.faab_bid != null && tx.faab_bid > 0
      ? tx.faab_bid
      : tx.compensation_amount != null && Number(tx.compensation_amount) > 0
        ? Number(tx.compensation_amount)
        : 0;
    if (amount <= 0) continue;

    const dir = TX_DIRECTIONS[tx.type as string];
    if (dir === 'out') totalSpent += amount;
    else if (dir === 'in') totalEarned += amount;

    const supply = TX_SUPPLY[tx.type as string] ?? 'neutral';
    if (supply === 'created') netCreated += amount;
    else if (supply === 'destroyed') netDestroyed += amount;
  }
  const startingBudget = myTeam.faab_budget + totalSpent - totalEarned;
```

- [ ] **Step 2: Pass the new values to the client component**

In the same file, add two props to the `<FinanceClient ... />` call, after `currentBudget={myTeam.faab_budget}`:

```tsx
      netCreated={netCreated}
      netDestroyed={netDestroyed}
```

- [ ] **Step 3: Accept and render them in FinanceClient**

The props interface is at `src/app/(dashboard)/league/[leagueId]/finance/FinanceClient.tsx:27-35`. Add two lines to it after `startingBudget: number;`:

```ts
  netCreated: number;
  netDestroyed: number;
```

Then add both names to the destructured parameter list, which begins at line 219 with `currentBudget,`. Render a summary row beneath the existing balance display. Use existing `--color-*` design tokens from `src/app/globals.css` — do not hardcode hex values — and reuse whatever card/stat class the file already applies to the balance figure rather than inventing a new one:

```tsx
        <div>
          <span>Money created</span>
          <strong>€{netCreated}m</strong>
        </div>
        <div>
          <span>Money destroyed</span>
          <strong>€{netDestroyed}m</strong>
        </div>
```

Copy rule: label these "Money created" / "Money destroyed", never "FAAB". Both themes (Cream Editorial and Premium Dark) must be checked.

- [ ] **Step 4: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 5: Verify in the browser**

Start the preview with the `preview_start` tool using the dev-server entry from `.claude/launch.json` — **never** run a dev server through Bash. Another session may already own port 3000 or 3010; check before starting.

Navigate to `/league/<id>/finance`, then:
- `read_page` to confirm the two new figures render.
- `read_console_messages` to confirm no errors.
- `resize_window` with `colorScheme: 'dark'` and screenshot, then light, to check both themes.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/league/[leagueId]/finance/page.tsx" \
        "src/app/(dashboard)/league/[leagueId]/finance/FinanceClient.tsx"
git commit -m "feat(finance): add merit/solidarity categories and money created vs destroyed readout"
```

---

## Task 10: Disclose committed-versus-available balance on the bid form

`auctions/bid/route.ts:67` validates each bid against the team's *current* balance with no awareness of other outstanding bids, so a manager with €250m can hold €250m top bids on three simultaneous auctions. The resolver re-checks affordability per auction and walks down to the next bidder, so nothing overdraws — but the manager silently loses auctions they believed they had won.

**This is a disclosure fix, not a hard block.** Bidding on several players while expecting to win one is legitimate, so blocking it would be worse than the current behaviour.

**Files:**
- Modify: `src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx`

**Interfaces:**
- Consumes: the `my_bid` field already present on each auction listing (`auctions/route.ts:123`).
- Produces: no new exports — UI only.

- [ ] **Step 1: Compute total committed from data already on the client**

The auctions array is state, declared at `TransferMarketClient.tsx:135` as `const [auctions, setAuctions] = useState<AuctionListing[]>(initialAuctions)`. The club's balance is `myTeam.faab_budget` (see line 320) — **not** a prop called `faabBudget`. Add this in the component body after line 143:

```tsx
  // Every bid this club currently leads or holds, summed. The API already
  // sends my_bid per auction, so this needs no new request.
  //
  // Why this is surfaced rather than enforced: the bid route checks each bid
  // against the current balance in isolation, so simultaneous bids can exceed
  // it. The resolver never overdraws — it walks down to the next affordable
  // bidder — but that means an auction you thought you had won goes elsewhere
  // with no warning. Bidding widely and expecting to win one is legitimate, so
  // the fix is to show the exposure, not to forbid it.
  const totalCommitted = auctions.reduce(
    (sum, a) => sum + (a.my_bid != null && a.my_bid > 0 ? a.my_bid : 0),
    0,
  );
  const openBidCount = auctions.filter((a) => a.my_bid != null && a.my_bid > 0).length;
  const overCommitted = totalCommitted > myTeam.faab_budget;
```

- [ ] **Step 2: Render the disclosure inside the bid modal**

In the bid modal (the block guarded by `modal.open`, near line 783 where `modal.isPromotedExclusive` is rendered), add above the submit button:

```tsx
              {openBidCount > 0 && (
                <p>
                  €{totalCommitted}m committed across {openBidCount} open bid
                  {openBidCount === 1 ? '' : 's'} · €{myTeam.faab_budget}m Club Balance
                  {overCommitted && (
                    <>
                      {' '}— your open bids exceed your Club Balance. If several
                      resolve together you will only win the ones you can afford.
                    </>
                  )}
                </p>
              )}
```

Style it with an existing muted-text or warning class from the file's CSS module and existing `--color-*` tokens. Copy rule: "Club Balance", never "FAAB", and amounts as `€{n}m`.

- [ ] **Step 3: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 4: Verify in the browser**

Using `preview_start` (never Bash), navigate to `/league/<id>/players`, open a bid modal, and `read_page` to confirm the disclosure line renders with the correct totals. Check `read_console_messages` for errors, and screenshot both colour schemes.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx"
git commit -m "feat(transfers): disclose total committed bids against Club Balance"
```

---

## Task 11: Delete the unreachable points penalty

**Files:**
- Modify: `src/lib/scoring/matchRating.ts:463`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `calculateFantasyPoints(rating, minutesPlayed)` keeps its signature and its observable output.

`if (rating < 3.0) finalPoints -= 2.0;` can never be observed. For any rating below 4.5 the curve `Math.pow(Math.max(0, rating - 4.5) / 2.0, 1.5)` is already 0, so `finalPoints` is 0, and the trailing `Math.max(0, ...)` clamps the subtraction away. This is item 3 of `docs/drafts/OPEN_RULES_QUESTIONS.md`.

- [ ] **Step 1: Add a test pinning the current observable behaviour**

Append to `src/lib/scoring/__tests__/matchRating.golden.test.ts`:

```ts
describe('calculateFantasyPoints floor', () => {
    // Migration note: a `if (rating < 3.0) finalPoints -= 2.0` line lived here
    // and could never be observed — the curve already yields 0 below 4.5 and
    // Math.max(0, ...) clamped the subtraction away. These assertions pin the
    // behaviour so removing the dead line is provably a no-op.
    it('returns zero for any rating at or below the curve floor', () => {
        for (const rating of [0.5, 1.0, 2.9, 3.0, 3.5, 4.0, 4.5]) {
            expect(calculateFantasyPoints(rating, 90)).toBe(0);
        }
    });

    it('never returns a negative value', () => {
        for (const rating of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
            expect(calculateFantasyPoints(rating, 90)).toBeGreaterThanOrEqual(0);
        }
    });

    it('returns zero for zero minutes regardless of rating', () => {
        expect(calculateFantasyPoints(9.0, 0)).toBe(0);
    });
});
```

Add `calculateFantasyPoints` to that file's existing import from `../matchRating` if it is not already imported.

- [ ] **Step 2: Run the test to confirm it passes BEFORE the change**

Run: `npm test src/lib/scoring`
Expected: PASS. This is the point — the test must pass both before and after, proving the deletion changes nothing.

- [ ] **Step 3: Delete the dead line**

In `src/lib/scoring/matchRating.ts`, delete this line entirely (line 463):

```ts
    if (rating < 3.0) finalPoints -= 2.0;
```

Then change `let finalPoints` to `const finalPoints` on the preceding line, since it is no longer reassigned:

```ts
    const finalPoints = basePoints + (scale * curve);
```

- [ ] **Step 4: Run the tests again**

Run: `npm test src/lib/scoring`
Expected: PASS, identical results. If any golden value moved, revert immediately — that would mean the line was reachable after all and the design doc's analysis is wrong.

- [ ] **Step 5: Typecheck and build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npm run build`
Expected: no typecheck output, build completes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoring/matchRating.ts src/lib/scoring/__tests__/matchRating.golden.test.ts
git commit -m "fix(scoring): remove unreachable -2.0 points penalty, pin the floor with tests"
```

---

## Task 12: Update the player guide and CLAUDE.md

**Files:**
- Modify: `docs/USER_GUIDE.md` — §8, §11, §13, §14, Quick Glossary; new §11 subsection
- Modify: `CLAUDE.md` — the "no test runner" claim and the "seven formations" claim
- Modify: `docs/drafts/OPEN_RULES_QUESTIONS.md` — mark item 3 resolved

**Interfaces:**
- Consumes: every rate settled in Tasks 1–8.
- Produces: documentation only.

The guide's opening states *"every figure here is a league setting or a code constant, verified against the source."* Every number below must match what actually shipped — re-read the constants rather than copying from this plan.

- [ ] **Step 1: Add monthly income to §11 Finance**

In `docs/USER_GUIDE.md`, replace the whole of §11 with:

```markdown
## 11. Finance

Your Finance page is your club's bank statement:

- Current **Club Balance**
- Spending and earnings broken down by category: signings, severance, trades, departure compensation, sale proceeds, loan fees and bonuses, recall penalties, prize payouts, monthly revenue and solidarity payments
- **Money created vs destroyed** — whether your club has taken more out of the league's money supply than it has put back
- A full paginated **transaction history** — date, type and amount of every move your club has made

### TV & Matchday Revenue

You are paid **during** the season, not only at the end of it. Every four gameweeks your results over that block are settled into your Club Balance:

| Result | Payment |
|---|---|
| Win | **€2.5m** |
| Draw | **€1.5m** |
| Loss | **€0.5m** |
| Bye *(odd-sized leagues)* | €1.5m |

Ten payments a season — after gameweeks 4, 8, 12, 16, 20, 24, 28, 32 and 36, plus a final settlement covering 37–38. A perfect month pays **€10m**; a winless one still pays **€2m**.

**Why during the season?** Because money that only arrives in June can only be spent in June. A club that has to wait until the reset to be paid does its business in one summer splurge and then sits out the year. Paying monthly means you can respond to an injury in October with a signing rather than a shrug.

**Why does a draw pay less than half a win?** Because of the draw band in §5. A margin of ten points or fewer is noise in the rating engine rather than a result, so it shouldn't pay like one.

Note that a win and a loss together pay exactly the same as two draws, so the league's total outlay is identical however the results fall. Nobody is paid out of anybody else's pocket.
```

- [ ] **Step 2: Rewrite the §8 rebate paragraph as the Scout's Fee**

In §8, replace:

```markdown
**If you start an auction and lose it, you're compensated:** you're refunded **20% of the winning bid, up to €5m**. You surfaced the player and drove the price, so you don't walk away with nothing.
```

with:

```markdown
### Where a transfer fee goes

When you sign a free agent, the fee doesn't vanish. **20% of every winning bid returns to the league**, split two ways:

- **Half to the Scout** — whoever opened that auction, if they didn't win it. That's **10% of the winning bid, with no cap**: surfacing a €150m signing pays €15m.
- **Half shared equally among the other clubs** who didn't win, as a **solidarity payment**.

The remaining 80% is retired from the league's money supply.

**Why?** Because a fee that simply disappears drains the league every time somebody spends. Your squad is only sellable if the other managers still have money, so a market where every big signing destroys cash eventually has no buyers in it. Football handles this the same way — a slice of every transfer fee is distributed to a player's former clubs, and the Premier League's central pot is largely an equal share. A bidding war between two clubs now funds everyone else.

The same 20% applies to the severance fee when you drop a player and to the loan slot buyback fee. There's no Scout's Fee on either, because no auction was opened.

Amounts are always whole millions, so a split that doesn't divide evenly leaves a remainder, and the remainder is retired.
```

- [ ] **Step 3: Update the §13 departure compensation figure**

In §13, replace:

```markdown
- **RELEASE** — take compensation equal to his market value. He enters the auction pool. **You are then barred from bidding on his return auction.**
```

with:

```markdown
- **RELEASE** — take compensation worth **60% of his market value**. He enters the auction pool. **You are then barred from bidding on his return auction.**
```

And append to that section:

```markdown
The rate is deliberately below full value. Paid in full, taking the cash would beat keeping the rights in almost every case, and the Retained List would be decoration. At 60% the trade is real: cash now against a claim on a player who might come back.
```

- [ ] **Step 4: Update §14 to reflect the smaller reset**

In §14, replace step 3:

```markdown
3. **Prizes are paid** into Club Balances per your league's prize structure, from both league and cup finishes.
```

with:

```markdown
3. **Placement and cup prizes are paid** into Club Balances. Finishing first pays **€40m**, scaling down to **€20m** for last — a flatter curve than it looks, because the bulk of league earnings now arrives monthly during the season (§11). Cup money is on top: **€40m** for the Champions Cup, **€20m** for the League Cup or the Consolation Cup.
```

- [ ] **Step 5: Update the Quick Glossary**

Replace the `Initiator rebate` row with:

```markdown
| **Scout's Fee** | 10% of the winning bid, uncapped, paid to whoever opened an auction they went on to lose. |
| **Solidarity payment** | An equal share of another 10% of every winning bid, paid to the clubs that didn't win it. |
| **TV & Matchday Revenue** | Your monthly income, settled every four gameweeks on your results. |
```

And amend the `Club Balance` row:

```markdown
| **Club Balance** | Your club's budget, used for signings, trades and loans. Earned monthly through results and at the reset through placement and cups. Never resets between seasons. |
```

- [ ] **Step 6: Fix two stale claims in CLAUDE.md**

Replace:

```markdown
There is no test runner configured in this repo (no `test` script, no test framework dependency) — do not assume Jest/Vitest exist.
```

with:

```markdown
Tests run under **vitest** (`npm test` → `vitest run`). `vitest.config.ts` includes only `src/**/__tests__/**/*.test.ts`; widen that glob when tests land elsewhere. Current coverage: the scoring engine (`src/lib/scoring/__tests__/`), the economy modules (`src/lib/economy/__tests__/`) and the prize curve (`src/lib/offseason/__tests__/`).
```

Then find the Position taxonomy paragraph and replace `Formations are restricted to 7 supported layouts (see README for the list).` with `Formations are restricted to **10** supported layouts — `src/types/index.ts` `Formation` is the source of truth. (README says seven; it is wrong.)`

- [ ] **Step 7: Close out the open-questions item**

In `docs/drafts/OPEN_RULES_QUESTIONS.md`, change the item 3 heading from `## 3. A dead points penalty for very poor ratings` to `## 3. RESOLVED — a dead points penalty for very poor ratings` and append:

```markdown
**Resolved 2026-07-29.** The line was vestigial and has been deleted (see Task 11
of the economy rebalance plan). Tests in `matchRating.golden.test.ts` now pin the
zero floor, so the removal is provably observation-free. Note the line was at
`:463`, not `:454` as recorded above.
```

- [ ] **Step 8: Verify every number against the source**

Run: `grep -rn "SEASON_PRIZE_FIRST\|SEASON_PRIZE_LAST\|DEFAULT_MERIT_RATES\|DEFAULT_SOLIDARITY_SHARE\|DEFAULT_SCOUT_SHARE\|COMPENSATION_RATE = " src/lib/`

Expected: 40, 20, `{win: 2.5, draw: 1.5, loss: 0.5, bye: 1.5}`, 0.20, 0.50, 0.6. Cross-check each against what you wrote in the guide and fix any divergence. The guide claims every figure is verified against source; that claim must stay true.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: build completes. (Markdown changes can't break it, but this is the final gate before the last commit.)

- [ ] **Step 10: Commit**

```bash
git add docs/USER_GUIDE.md CLAUDE.md docs/drafts/OPEN_RULES_QUESTIONS.md
git commit -m "docs: document monthly revenue, scout fee and solidarity; fix stale CLAUDE.md claims"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: all tests pass across `src/lib/scoring/__tests__/`, `src/lib/economy/__tests__/` and `src/lib/offseason/__tests__/`.

- [ ] **Typecheck**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: no output.

- [ ] **Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Build**

Run: `npm run build`
Expected: build completes without errors. **This is the project's only correctness gate besides the tests — do not report the work done until it passes.**

- [ ] **Confirm the migration set with the user**

Four migrations must be applied by hand in the Supabase SQL editor, in order:

1. `091_economy_settings.sql` — rate columns, departure rate 0.6, `faab_budget` default 250
2. `092_merit_payments.sql` — `merit_payments` table, `merit_payment` enum, `credit_merit_payment`
3. `093_solidarity_on_auctions.sql` — `solidarity_payment` enum, resolver rewrite
4. `094_solidarity_on_drops_and_buyback.sql` — `distribute_solidarity`, buyback update

**None of the money changes take effect until these are run.** State this explicitly rather than reporting the feature as live.

- [ ] **Report honestly what was and was not verified**

The pure arithmetic in `meritPayments.ts`, `solidarity.ts` and `prizeDistribution.ts` is covered by unit tests. The four RPCs are **not** — this repo has no database test harness, and one was deliberately not built for this plan. Their verification is the manual SQL in Tasks 3, 7 and 8, which the user must run. Say so plainly; do not describe the SQL as tested.
