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
import { calculateMatchRating, GK_CURVE_SCALE } from '../matchRating';
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

    it('still have their curve output compressed', () => {
        // GK composite is ~56% more dispersed than an outfielder's (sd 0.245 vs
        // 0.157) and a convex curve turns spread into points, so without this
        // keepers average 10.62 to an outfielder's 7.27. It goes away only when
        // the GK rating itself stops being a clean-sheet switch — see
        // docs/superpowers/specs/2026-08-23-goalkeeper-rating-design.md
        expect(GK_CURVE_SCALE).toBeLessThan(1);
        const strong = quiet({ saves: 6, goals_conceded: 0, clean_sheet: true, bps: 30,
            expected_goals_conceded: 2.4 });
        const asGk = calculateMatchRating(strong, 'GK').fantasyPoints;
        const asCb = calculateMatchRating(strong, 'CB').fantasyPoints;
        expect(asGk).toBeLessThan(asCb / GK_CURVE_SCALE);
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
