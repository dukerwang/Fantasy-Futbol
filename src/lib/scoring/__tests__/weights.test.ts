/**
 * Gaffa — scoring weight-table invariants
 *
 * These assert arithmetic and range properties of POSITION_WEIGHTS / FLEX_CONFIG
 * that TypeScript cannot express. Key completeness (all 12 positions, all 8
 * components) is already guaranteed by the `Record<GranularPosition, ...>` /
 * `Record<RatingComponent, number>` types plus `tsc --noEmit`, so it is
 * deliberately not re-tested here.
 *
 * Why these matter: the composite produced by applyPositionWeights() is
 * documented as 0.0–1.0, and that range holds only because each position's
 * base weights plus its single flex boost sum to exactly 1.00. Tuning a weight
 * without rebalancing silently moves the composite range, which shifts every
 * rating and point total with no error raised.
 */

import { describe, it, expect } from 'vitest';
import { RATING_COMPONENTS } from '@/types';
import type { GranularPosition, RatingComponent } from '@/types';
import { POSITION_WEIGHTS, FLEX_CONFIG } from '../matchRating';

const POSITIONS = Object.keys(POSITION_WEIGHTS) as GranularPosition[];

// The two tables are typed independently, so a divergence is possible if either
// type is ever loosened. Cheap to assert, and it keeps the loops below honest.
describe('table alignment', () => {
    it('POSITION_WEIGHTS and FLEX_CONFIG cover the same positions', () => {
        expect(Object.keys(FLEX_CONFIG).sort()).toEqual(POSITIONS.slice().sort());
    });

    it('covers all 12 taxonomy positions', () => {
        expect(POSITIONS).toHaveLength(12);
    });
});

describe.each(POSITIONS)('%s weights', (pos) => {
    const base = POSITION_WEIGHTS[pos];
    const flex = FLEX_CONFIG[pos];
    const baseSum = RATING_COMPONENTS.reduce((acc, c) => acc + base[c], 0);

    // 1 — the load-bearing invariant. Currently GK is 0.80 + 0.20 and the other
    // eleven are 0.75 + 0.25; both reach 1.00. The split is a design choice and
    // is not asserted, only the total.
    it('base weights + flex boost sum to exactly 1.00', () => {
        expect(baseSum + flex.flex).toBeCloseTo(1.0, 10);
    });

    // 2 — `number` permits negatives, which would invert a component's meaning.
    it('has no negative weights', () => {
        for (const c of RATING_COMPONENTS) {
            expect(base[c], `${pos}.${c}`).toBeGreaterThanOrEqual(0);
        }
    });

    // 3 — a zero flex would disable the mechanism; above 1 is nonsensical.
    it('flex boost is within (0, 1]', () => {
        expect(flex.flex).toBeGreaterThan(0);
        expect(flex.flex).toBeLessThanOrEqual(1);
    });

    // 4 — the one that guards a real silent failure. applyPositionWeights picks
    // the highest-scoring entry in `components` and adds `flex` to it. With an
    // empty list nothing is ever selected, no boost is applied, and the
    // composite caps at baseSum (0.75) instead of 1.00 — a ~25% depression of
    // every rating at this position, with no error thrown.
    it('has a non-empty flex component list', () => {
        expect(flex.components.length).toBeGreaterThan(0);
    });

    // 5 — harmless at runtime (the max scan is idempotent) but always a typo.
    it('has no duplicate flex components', () => {
        expect(new Set(flex.components).size).toBe(flex.components.length);
    });

    // 6 — the flex boost lands on exactly one component, so the largest weight
    // any single component can carry is max(base) + flex. Keeping that <= 1.00
    // preserves the documented composite range.
    it('cannot give a single component an effective weight above 1.00', () => {
        const maxBase = Math.max(
            ...flex.components.map((c: RatingComponent) => base[c]),
        );
        expect(maxBase + flex.flex).toBeLessThanOrEqual(1.0 + 1e-10);
    });
});
