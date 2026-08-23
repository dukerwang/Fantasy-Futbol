/**
 * Gaffa — scoring engine golden (characterization) tests
 *
 * These assert that scoring output HAS NOT CHANGED. They do not assert that it
 * is correct — the baseline below was generated from the engine as it stood when
 * these tests were written, so a bug present then is frozen in too.
 *
 * When a case goes red, that is not automatically a failure. Read the
 * `describes` field of the fixture in ./fixtures.ts, decide whether the new
 * number is an intended consequence of a retune or an accidental regression,
 * and either regenerate the baseline or fix the change. CLAUDE.md warns that
 * touching weights, SIGMOID_K or the point curve breaks historical
 * comparability; this file is what makes that visible before it ships.
 *
 * If you regenerate: also re-run scripts/backfill-scoring-v2.mjs and
 * scripts/recompute_reference_stats.mjs, per CLAUDE.md.
 *
 * These are stable because the whole path is pure — no Date, no Math.random, no
 * I/O, no env — and refStats defaults to the in-repo DEFAULT_REFERENCE_STATS
 * rather than the rating_reference_stats table. Output is already rounded to 2dp
 * by calculateMatchRating, so exact equality is safe.
 *
 * Baseline captured: scoring v2 (DEFAULT_REFERENCE_STATS generated from 2025-26
 * FPL live data, GW1-35, minutes>=45).
 *
 * Revised twice on 2026-08-23. First when the keeper-only appearance credit was
 * removed, which put every outfield figure back where it had been and took 2.5
 * off the keepers. Then when the goalkeeper rating was rebuilt to measure
 * goalkeeping rather than the scoreline — only the two GK cases move, and they
 * move in opposite directions, which is the whole point:
 *
 *   gk-busy-loss          6.47 / 2.36  ->  6.83 / 6.44   (he was making saves)
 *   gk-quiet-clean-sheet  8.63 / 21.82 ->  7.53 / 14.41  (he was not troubled)
 *
 * Every outfield case is untouched by that second change.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchRating, calculateFantasyPoints } from '../matchRating';
import { CASES } from './fixtures';

const BASELINE: Record<string, { rating: number; fantasyPoints: number }> = {
    'st-brace': { rating: 9.01, fantasyPoints: 36.72 },
    'st-quiet': { rating: 6.92, fantasyPoints: 7.38 },
    'gk-busy-loss': { rating: 6.83, fantasyPoints: 6.44 },
    'gk-quiet-clean-sheet': { rating: 7.53, fantasyPoints: 14.41 },
    'cb-clean-sheet': { rating: 8.41, fantasyPoints: 26.94 },
    'cm-assist': { rating: 8.34, fantasyPoints: 25.79 },
    'am-two-assists': { rating: 8.94, fantasyPoints: 35.57 },
    'lwb-assist-clean-sheet': { rating: 8.57, fantasyPoints: 29.4 },
    'cm-poor-game': { rating: 5.5, fantasyPoints: 0 },
    'oop-striker-at-cb': { rating: 6.08, fantasyPoints: 12.25 },
    'cameo-five-minutes': { rating: 6.14, fantasyPoints: 1.08 },
    'did-not-play': { rating: 0, fantasyPoints: 0 },
};

describe('calculateMatchRating — golden baseline', () => {
    it('every fixture has a baseline entry', () => {
        expect(Object.keys(BASELINE).sort()).toEqual(CASES.map((c) => c.name).sort());
    });

    describe.each(CASES.map((c) => [c.name, c] as const))('%s', (name, c) => {
        const actual = calculateMatchRating(c.stats, c.position, undefined, c.primaryPosition);

        it(c.describes, () => {
            expect({ rating: actual.rating, fantasyPoints: actual.fantasyPoints }).toEqual(
                BASELINE[name],
            );
        });
    });
});

/**
 * Relational invariants — these survive a retune, so they are stronger than the
 * frozen numbers above and should not need regenerating.
 */
describe('calculateMatchRating — structural guarantees', () => {
    it('applies exactly a 20% penalty to an out-of-position defender', () => {
        const c = CASES.find((x) => x.name === 'oop-striker-at-cb')!;
        const penalized = calculateMatchRating(c.stats, 'CB', undefined, 'ST');
        const native = calculateMatchRating(c.stats, 'CB', undefined, 'CB');

        // Both values are rounded to 2dp after the multiply, so the ratio is
        // 0.80 only to within rounding.
        expect(penalized.rating / native.rating).toBeCloseTo(0.8, 3);
        expect(penalized.fantasyPoints / native.fantasyPoints).toBeCloseTo(0.8, 3);
    });

    it('does not penalise a defender playing their own position', () => {
        const c = CASES.find((x) => x.name === 'oop-striker-at-cb')!;
        const native = calculateMatchRating(c.stats, 'CB', undefined, 'CB');
        const noPrimary = calculateMatchRating(c.stats, 'CB', undefined, undefined);
        expect(noPrimary).toEqual(native);
    });

    it('returns a hard zero for an unused substitute', () => {
        const c = CASES.find((x) => x.name === 'did-not-play')!;
        const r = calculateMatchRating(c.stats, c.position);
        expect(r.rating).toBe(0);
        expect(r.fantasyPoints).toBe(0);
        expect(r.breakdown).toEqual([]);
    });

    it('never returns negative fantasy points', () => {
        for (const c of CASES) {
            const r = calculateMatchRating(c.stats, c.position, undefined, c.primaryPosition);
            expect(r.fantasyPoints, c.name).toBeGreaterThanOrEqual(0);
        }
    });

    it('keeps every display rating within the 0-10 scale', () => {
        for (const c of CASES) {
            const r = calculateMatchRating(c.stats, c.position, undefined, c.primaryPosition);
            expect(r.rating, c.name).toBeGreaterThanOrEqual(0);
            expect(r.rating, c.name).toBeLessThanOrEqual(10);
        }
    });

    it('applies the flex boost — a played match always beats the unflexed base ceiling', () => {
        // Regression guard for the silent failure mode described in weights.test.ts:
        // if FLEX_CONFIG.components were emptied, or a component score arrived as
        // NaN/undefined, no component would receive the flex boost and the
        // composite would cap at the base sum. A strong performance would then be
        // capped well below its current rating.
        const brace = CASES.find((x) => x.name === 'st-brace')!;
        const r = calculateMatchRating(brace.stats, brace.position);
        expect(r.rating).toBeGreaterThan(8.5);
    });
});

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
