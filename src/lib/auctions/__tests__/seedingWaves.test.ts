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
