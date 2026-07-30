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
