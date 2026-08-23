/**
 * Keepers must not be paid for turning out when nobody else is.
 *
 * Goalkeepers alone used to carry a 2.5 appearance credit. The points curve pays
 * nothing below roughly a 5.84 display rating, so that credit inverted rating
 * against points across positions: a keeper who did nothing banked 2.5 while a
 * better-rated outfielder banked zero. GW1 2026-27 had Roefs (4.65) out-scoring
 * Rice (6.16), 2.50 to 1.23.
 *
 * The credit is gone for every position. Nobody gets participation points, which
 * is what docs/USER_GUIDE.md has always said.
 */
import { describe, it, expect } from 'vitest';
import { calculateMatchRating, calculateFantasyPoints, GK_CURVE_SCALE } from '../matchRating';
import type { GranularPosition } from '@/types';

/** A 90-minute appearance with nothing much in it. */
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
const pts = (s: any, pos: GranularPosition) => calculateMatchRating(s, pos).fantasyPoints;

describe('no appearance credit', () => {
    it('pays nobody for merely turning out, keepers included', () => {
        // A blank 90 in a team that conceded three. Restricted to positions this
        // line actually rates below the curve's threshold: attackers are not
        // charged for goals conceded, so the same stats leave a striker around
        // 6.01 and legitimately in the money. That is the position weighting
        // working, not a floor.
        const nothing = quiet({ bps: 0, fpl_def_contrib: 0, fpl_cbi: 0, fpl_recoveries: 0,
            fpl_tackles: 0, influence: 0, creativity: 0, threat: 0, goals_conceded: 3 });
        for (const pos of ['GK', 'CB', 'LB', 'RB', 'DM', 'CM'] as GranularPosition[]) {
            expect(pts(nothing, pos)).toBe(0);
        }
    });

    it('leaves a keeper who conceded without a save on zero, not 2.5', () => {
        // The exact regression: this line used to bank the keeper-only credit.
        const beaten = quiet({ saves: 0, goals_conceded: 2, clean_sheet: false, bps: 7,
            expected_goals_conceded: 1.8, influence: 16.3, creativity: 0.5, threat: 0 });
        expect(pts(beaten, 'GK')).toBe(0);
    });

    it('does not vary with minutes', () => {
        // Rating carries no minutes term, so points must not either, or two
        // players on one rating would bank different scores.
        const a = calculateMatchRating(quiet({ minutes_played: 90 }), 'CM');
        const b = calculateMatchRating(quiet({ minutes_played: 20 }), 'CM');
        expect(b.rating).toBeCloseTo(a.rating, 5);
        expect(b.fantasyPoints).toBeCloseTo(a.fantasyPoints, 5);
    });
});

describe('keepers', () => {
    it('no longer out-score a better-rated outfielder over the same minutes', () => {
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

    it('are rated on their own work, not on whether the defence held', () => {
        // The defect this replaced: a clean sheet was worth +20 in `defensive`
        // and floored `save_score` at 0.86, so an untroubled shutout and a
        // seven-save one landed within 0.2 of each other.
        const untroubled = calculateMatchRating(
            quiet({ saves: 0, goals_conceded: 0, clean_sheet: true, bps: 18,
                expected_goals_conceded: 0.4 }), 'GK');
        const earned = calculateMatchRating(
            quiet({ saves: 7, goals_conceded: 0, clean_sheet: true, bps: 34,
                expected_goals_conceded: 2.6 }), 'GK');
        // Was ~0.6 between these two before the fix; ~1.0 now.
        expect(earned.rating - untroubled.rating).toBeGreaterThan(0.85);
    });

    it('can out-rate a shutout by keeping well in defeat', () => {
        // Fotmob would have the eight-save keeper in a 2-1 loss well clear of one
        // who watched a comfortable 0-0. Gaffa used to have it the other way.
        const untroubled = calculateMatchRating(
            quiet({ saves: 0, goals_conceded: 0, clean_sheet: true, bps: 18,
                expected_goals_conceded: 0.4 }), 'GK');
        const outstanding = calculateMatchRating(
            quiet({ saves: 8, goals_conceded: 1, clean_sheet: false, bps: 32,
                expected_goals_conceded: 3.0 }), 'GK');
        expect(outstanding.rating).toBeGreaterThan(untroubled.rating);
    });

    it('carry a curve scale so both positions bank the same on average', () => {
        // Keeper composite stays more dispersed than an outfielder's even with
        // the rating fixed, and a convex curve turns spread into points. 0.80 is
        // what levels the two at 7.27 an appearance across 2025-26. Deleting it
        // is only possible by flattening the rating until the leaderboard stops
        // telling keepers apart, which is what a first attempt did.
        expect(GK_CURVE_SCALE).toBeLessThan(1);
        const line = quiet({ saves: 4, goals_conceded: 1, clean_sheet: false, bps: 26,
            expected_goals_conceded: 2.2 });
        const gk = calculateMatchRating(line, 'GK');
        // Composite is reconstructed from a rating already rounded to 2dp, so
        // this is only good to about a tenth of a point.
        const unscaled = calculateFantasyPoints(1 + 9 * ((gk.rating - 3.5) / 6), 90);
        expect(gk.fantasyPoints).toBeCloseTo(unscaled * GK_CURVE_SCALE, 1);
    });
});

describe('a sub-threshold game', () => {
    it('is worth nothing, and every one of them the same nothing', () => {
        // Deliberate: grading poor games apart means recutting the curve, which
        // compresses team margins enough to take the draw rate from ~18% to ~46%.
        const bad = calculateMatchRating(quiet({ bps: 0, fpl_def_contrib: 0, fpl_cbi: 0,
            fpl_recoveries: 0, influence: 0, creativity: 0, threat: 0 }), 'CB');
        const lessBad = calculateMatchRating(quiet({ bps: 5, fpl_def_contrib: 3, fpl_cbi: 2,
            fpl_recoveries: 1, influence: 4, creativity: 2, threat: 1 }), 'CB');
        expect(lessBad.rating).toBeGreaterThan(bad.rating);
        expect(bad.fantasyPoints).toBe(0);
        expect(lessBad.fantasyPoints).toBe(0);
    });
});
