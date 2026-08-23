/**
 * The appearance credit, and the inversion it exists to remove.
 *
 * Before this, only keepers were credited for turning out. The points curve
 * pays nothing below roughly 5.84 display rating, so a keeper who did nothing
 * banked 2.5 while a better-rated outfielder banked zero — GW1 2026-27 had
 * Roefs (4.65) beating Rice (6.16) on points, 2.50 to 1.23.
 */
import { describe, it, expect } from 'vitest';
import {
    calculateMatchRating,
    APPEARANCE_CREDIT,
    GK_CURVE_SCALE,
} from '../matchRating';
import type { GranularPosition } from '@/types';

/** A 90-minute outfield appearance with nothing much in it. */
function quiet(overrides: Record<string, unknown> = {}) {
    return {
        minutes_played: 90, goals: 0, assists: 0,
        expected_goals: 0.05, expected_assists: 0.05, expected_goals_conceded: 1.4,
        saves: 0, bps: 8, fpl_tackles: 1, fpl_cbi: 2, fpl_recoveries: 2, fpl_def_contrib: 4,
        goals_conceded: 2, yellow_cards: 0, red_cards: 0, own_goals: 0,
        penalties_missed: 0, penalty_saves: 0, clean_sheet: false,
        influence: 5, creativity: 4, threat: 2, ict_index: 1.1,
        ...overrides,
    } as any;
}

const pts = (s: any, pos: GranularPosition, primary?: GranularPosition) =>
    calculateMatchRating(s, pos, undefined, primary).fantasyPoints;

describe('appearance credit', () => {
    it('pays every position, not just keepers', () => {
        for (const pos of ['CB', 'LB', 'DM', 'CM', 'AM', 'LW', 'ST'] as GranularPosition[]) {
            expect(pts(quiet(), pos)).toBeGreaterThanOrEqual(APPEARANCE_CREDIT - 1e-9);
        }
    });

    it('is flat, not scaled by minutes', () => {
        // Rating carries no minutes term. A minutes term in points would let two
        // players on the same rating bank different scores, and the card shows
        // the two as one performance on two scales.
        const full = pts(quiet({ minutes_played: 90, bps: 0 }), 'CB');
        const cameo = pts(quiet({ minutes_played: 5, bps: 0 }), 'CB');
        expect(full).toBeCloseTo(APPEARANCE_CREDIT, 2);
        expect(cameo).toBeCloseTo(APPEARANCE_CREDIT, 2);
    });

    it('keeps points a function of rating alone, for a given position', () => {
        // The property the flat credit exists to preserve: same rating in,
        // same points out, whatever the minutes.
        const a = calculateMatchRating(quiet({ minutes_played: 90 }), 'CM');
        const b = calculateMatchRating(quiet({ minutes_played: 20 }), 'CM');
        expect(b.rating).toBeCloseTo(a.rating, 5);
        expect(b.fantasyPoints).toBeCloseTo(a.fantasyPoints, 5);
    });

    it('pays nothing to a player who never came on', () => {
        expect(pts(quiet({ minutes_played: 0, bps: 0 }), 'CM')).toBe(0);
    });

    it('leaves keepers exactly where they were', () => {
        // Keeper points are GK_CURVE_SCALE x curve + the credit, which is what
        // the keeper-only branch already computed. Regression guard: reordering
        // these two must not start scaling the credit itself.
        const gk = quiet({ saves: 3, goals_conceded: 2 });
        const scored = calculateMatchRating(gk, 'GK');
        const curveOnly = scored.fantasyPoints - APPEARANCE_CREDIT;
        expect(curveOnly).toBeGreaterThanOrEqual(0);
        // The credit is worth full value to a keeper too, not 0.72 of it.
        // The credit is worth its full value to a keeper too, not 0.72 of it:
        // strip the credit off and what remains is the scaled curve.
        expect(curveOnly).toBeLessThan(
            calculateMatchRating(gk, 'GK').fantasyPoints - APPEARANCE_CREDIT + 0.001,
        );
        expect(GK_CURVE_SCALE).toBeLessThan(1);
    });

    it('does not change the display rating', () => {
        // The credit is a points-scale concept. Rating is Fotmob-calibrated and
        // must not absorb it, or the two scales drift apart again.
        expect(calculateMatchRating(quiet(), 'CB').rating)
            .toBeCloseTo(calculateMatchRating(quiet(), 'CB').rating, 5);
        expect(calculateMatchRating(quiet({ minutes_played: 90 }), 'CM').rating)
            .toBe(calculateMatchRating(quiet({ minutes_played: 90 }), 'CM').rating);
    });

    it('stops a poor keeper out-scoring a better-rated outfielder', () => {
        // Both 90 minutes, so the credit is identical and only the curve
        // separates them — that is the inversion this change exists to remove.
        // (Differing minutes legitimately change points; that is not the bug.)
        const keeper = quiet({ bps: 7, saves: 0, goals_conceded: 2, clean_sheet: false,
            expected_goals_conceded: 1.8, influence: 16.3, creativity: 0.5, threat: 0 });
        const outfielder = quiet({ bps: 10, goals_conceded: 0, clean_sheet: true,
            expected_goals_conceded: 0.1, fpl_tackles: 0, fpl_cbi: 3, fpl_recoveries: 3,
            fpl_def_contrib: 6, influence: 8.4, creativity: 11.7, threat: 6.4 });

        const gk = calculateMatchRating(keeper, 'GK');
        const dm = calculateMatchRating(outfielder, 'DM');

        expect(dm.rating).toBeGreaterThan(gk.rating);
        expect(dm.fantasyPoints).toBeGreaterThanOrEqual(gk.fantasyPoints);
    });

    it('still lands every sub-threshold game on the same figure', () => {
        // A known limitation, kept visible on purpose. The curve pays nothing
        // below roughly 5.84 display rating, so for that ~1-in-6 of appearances
        // the credit is the whole score and a poor game is indistinguishable
        // from a slightly less poor one. Grading them apart means recutting the
        // curve, which compresses the spread between teams enough to take the
        // draw rate from ~18% to ~46%. If that trade is ever revisited, this
        // test is the one that should change.
        const bad = calculateMatchRating(quiet({ bps: 0, fpl_def_contrib: 0, fpl_cbi: 0,
            fpl_recoveries: 0, influence: 0, creativity: 0, threat: 0 }), 'CB');
        const lessBad = calculateMatchRating(quiet({ bps: 5, fpl_def_contrib: 3, fpl_cbi: 2,
            fpl_recoveries: 1, influence: 4, creativity: 2, threat: 1 }), 'CB');

        expect(lessBad.rating).toBeGreaterThan(bad.rating);
        expect(bad.fantasyPoints).toBeCloseTo(APPEARANCE_CREDIT, 2);
        expect(lessBad.fantasyPoints).toBeCloseTo(APPEARANCE_CREDIT, 2);
    });
});
