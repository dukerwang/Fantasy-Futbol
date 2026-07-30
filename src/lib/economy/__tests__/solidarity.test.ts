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
