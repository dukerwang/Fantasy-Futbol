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
