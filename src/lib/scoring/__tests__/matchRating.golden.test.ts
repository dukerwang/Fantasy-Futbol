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
 *   gk-busy-loss          6.47 / 2.36  ->  6.84 / 5.54   (he was making saves)
 *   gk-quiet-clean-sheet  8.63 / 21.82 ->  8.05 / 18.00  (he was not troubled)
 *
 * Every outfield case is untouched by that second change.
 *
 * Revised a third time on 2026-08-24 when the points curve's pivot/scale moved
 * from 4.5/10.0 to 4.0/8.6 (zero-line 5.83 -> 5.5 display), so that a merely
 * decent-but-not-average game stopped paying next to nothing. Every case moves
 * up except the two already at/near the floor (cm-poor-game, did-not-play),
 * and the elite cases (st-brace, am-two-assists) barely move — that's the
 * ceiling-preservation the rescale was for.
 *
 * Added two new fixtures on 2026-08-25 (st-hattrick, am-elite-creativity) for
 * the rare-feat kicker — a hat-trick or an elite creativity outlier now buys
 * a self-limiting bump on top of the saturated composite (see
 * applyRareFeatBump in matchRating.ts). One existing fixture moves too:
 * st-brace (2 goals + 1 assist, goalInvRaw=16) turns out to already be past
 * the kicker's ~11.5 saturation line on its own, 9.01/36.69 -> 9.25/40.60 —
 * not a bug, the combined-raw design deliberately doesn't require 3 goals or
 * 3 assists specifically, just enough combined output to be past the line.
 * Every other fixture is untouched: none of them cross either trigger.
 *
 * Revised again later on 2026-08-25 when the rare-feat bonus changed shape —
 * from a bump on the composite to flat points added after the curve, and from
 * a positional creativity z-score to an absolute creativity bar of 90. See
 * docs/superpowers/specs/2026-08-25-rare-feat-bonus-design.md. Exactly the
 * four feat fixtures move, and each in a way the change predicts:
 *
 *   st-brace             9.25/40.60 -> 9.01/38.94
 *   st-hattrick          9.36/42.37 -> 9.12/41.79
 *   am-elite-creativity  9.23/40.17 -> 8.98/39.66
 *   am-two-assists       8.94/35.64 -> 8.94/35.70
 *
 * The ratings drop because the display rating no longer receives the bonus at
 * all — it is a points-scale reward now, and 9.12 is a realistic rating for a
 * hat-trick. am-two-assists is the interesting one: its rating does NOT move
 * (it never triggered a bump) but it gains 0.06 points, because its creativity
 * of ~90.3 sits BELOW the old z-bar (an AM needed 94.1 raw to clear z 3.9) and
 * just ABOVE the new absolute bar of 90. That is the whole point of the swap —
 * the old threshold was measuring positional baseline, not creative quality.
 *
 * This regeneration deliberately did NOT re-run backfill-scoring-v2.mjs or
 * recompute_reference_stats.mjs (see the note above). Duke's call: the code
 * lands, completed history keeps its old scores for now, and the backfill
 * joins the queue the 2026-08-24 curve retune is already waiting in.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchRating, calculateFantasyPoints, POSITION_WEIGHTS } from '../matchRating';
import { CASES } from './fixtures';

const BASELINE: Record<string, { rating: number; fantasyPoints: number }> = {
    'st-brace': { rating: 9.01, fantasyPoints: 38.94 },
    'st-quiet': { rating: 6.92, fantasyPoints: 9.47 },
    'gk-busy-loss': { rating: 6.84, fantasyPoints: 7.31 },
    'gk-quiet-clean-sheet': { rating: 8.05, fantasyPoints: 19.1 },
    'cb-clean-sheet': { rating: 8.41, fantasyPoints: 27.8 },
    'cm-assist': { rating: 8.34, fantasyPoints: 26.75 },
    'am-two-assists': { rating: 8.94, fantasyPoints: 35.7 },
    'st-hattrick': { rating: 9.12, fantasyPoints: 41.79 },
    'am-elite-creativity': { rating: 8.98, fantasyPoints: 39.66 },
    'lwb-assist-clean-sheet': { rating: 8.57, fantasyPoints: 30.04 },
    'cm-poor-game': { rating: 5.5, fantasyPoints: 0 },
    'oop-striker-at-cb': { rating: 6.08, fantasyPoints: 13.64 },
    'cameo-five-minutes': { rating: 6.14, fantasyPoints: 2.83 },
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

    it('never triggers the creativity rare-feat kicker for a goalkeeper', () => {
        // Creativity carries zero weight for GK, so an anomalous value must
        // not move the rating. (goals/assists aren't varied here — they'd
        // change match_impact's bps-adjustment for ANY position, which is
        // unrelated to the kicker and would confound this check.)
        const c = CASES.find((x) => x.name === 'gk-busy-loss')!;
        const withCreativity = calculateMatchRating({ ...c.stats, creativity: 200 }, 'GK');
        const baseline = calculateMatchRating(c.stats, 'GK');
        expect(withCreativity.rating).toBe(baseline.rating);
        expect(withCreativity.fantasyPoints).toBe(baseline.fantasyPoints);
    });

    it('goal_involvement carries zero weight for GK, the precondition the kicker gate relies on', () => {
        // The gate in calculateMatchRating (`posWeights.goal_involvement > 0`)
        // is only correct because this holds. Can't test the goal/assist
        // trigger end-to-end via rating for GK the way the creativity test
        // above does — goals/assists also feed match_impact's bps-adjustment
        // (a real, separate mechanic) for every position, GK included, so a
        // rating comparison would be confounded. This asserts the gate's
        // precondition directly instead.
        expect(POSITION_WEIGHTS.GK.goal_involvement).toBe(0);
    });

    it('rare-feat kicker never pushes rating past the 10 ceiling', () => {
        const c = CASES.find((x) => x.name === 'st-hattrick')!;
        const r = calculateMatchRating({ ...c.stats, goals: 8 }, 'ST');
        expect(r.rating).toBeLessThanOrEqual(10);
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
    // and could never be observed — the curve already yields 0 below the pivot
    // (4.0) and Math.max(0, ...) clamped the subtraction away. These
    // assertions pin the behaviour so removing the dead line is provably a
    // no-op.
    it('returns zero for any rating at or below the curve floor', () => {
        for (const rating of [0.5, 1.0, 2.9, 3.0, 3.5, 4.0]) {
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

/**
 * Guards for the 2026-08-25 rare-feat rework. These assert PROPERTIES rather
 * than frozen numbers, so they survive a future retune of the constants while
 * still catching a return to the old shape.
 */
describe('rare-feat bonus — shape guarantees', () => {
    const base = CASES.find((c) => c.name === 'st-quiet')!.stats;

    it('pays the same bonus regardless of how good the rest of the game was', () => {
        // The defect the additive model exists to fix: the old headroom bump
        // spent the REMAINING distance to composite 1.0, so it paid a bigger
        // bonus to a WORSE supporting performance (+7.24 off a 0.84 composite
        // vs +2.90 off a 0.94 one). A hat-trick is a hat-trick.
        const hattrick = { goals: 3, assists: 0 };
        const weakSupport = { ...base, ...hattrick, bps: 20, influence: 20, threat: 30 };
        const strongSupport = { ...base, ...hattrick, bps: 60, influence: 70, threat: 90 };

        const weakBonus = calculateMatchRating(weakSupport, 'ST').fantasyPoints
            - calculateMatchRating({ ...weakSupport, goals: 0, assists: 0 }, 'ST').fantasyPoints;
        const strongBonus = calculateMatchRating(strongSupport, 'ST').fantasyPoints
            - calculateMatchRating({ ...strongSupport, goals: 0, assists: 0 }, 'ST').fantasyPoints;

        // Not equal — removing the goals also moves the correlated components —
        // but the FEAT portion is flat, so the gap cannot invert the way the
        // headroom model made it invert.
        expect(strongBonus).toBeGreaterThan(weakBonus);
    });

    it('is monotonic in excess — more output never pays less', () => {
        const pts = (goals: number, assists: number) =>
            calculateMatchRating({ ...base, goals, assists, minutes_played: 90 }, 'ST').fantasyPoints;
        const ladder = [pts(2, 1), pts(3, 0), pts(3, 1), pts(3, 2), pts(4, 1), pts(5, 2)];
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]);
        }
        // And the range is no longer crushed against the old 44.69 ceiling.
        expect(ladder[ladder.length - 1] - ladder[0]).toBeGreaterThan(8);
    });

    it('has no kink where the old positional creativity bar used to sit', () => {
        // A CB cleared the old z-score of 3.9 at raw creativity 26.1, which is
        // why 23 of the 96 firings in 2025-26 were centre-backs. Creativity
        // still moves a CB's score through its own component (weight 0.05) —
        // that is ordinary scoring — but there must be no DISCONTINUITY at
        // 26.1 any more. Compare the rise either side of it: under the old
        // trigger the second span carried a kicker the first did not.
        const cb = CASES.find((c) => c.name === 'cb-clean-sheet')!;
        const at = (creativity: number) =>
            calculateMatchRating({ ...cb.stats, creativity }, 'CB').fantasyPoints;
        const below = at(26) - at(20);
        const across = at(32) - at(26);
        expect(Math.abs(across - below)).toBeLessThan(0.5);
    });

    it('does produce a step at the absolute bar for a position graded on creating', () => {
        const am = CASES.find((c) => c.name === 'am-two-assists')!;
        const at = (creativity: number) =>
            calculateMatchRating({ ...am.stats, creativity }, 'AM').fantasyPoints;
        // 15 raw = one unit of excess = FEAT_POINTS_PER_UNIT on top of whatever
        // the smooth component already gave, so the span that crosses the bar
        // must outrun the equal-width span just below it.
        const below = at(89) - at(74);
        const across = at(105) - at(90);
        expect(across).toBeGreaterThan(below + 2);
    });

    it('the display rating never receives the feat bonus', () => {
        const quiet = calculateMatchRating({ ...base, goals: 0, assists: 0, creativity: 0 }, 'ST');
        const feat = calculateMatchRating({ ...base, goals: 0, assists: 0, creativity: 200 }, 'ST');
        // Creativity carries weight for ST, so the composite moves and the
        // rating with it — but the 200 is 110 past the bar, worth +22 points,
        // and none of that may reach the rating.
        expect(feat.fantasyPoints - quiet.fantasyPoints).toBeGreaterThan(20);
        expect(feat.rating).toBeLessThan(10);
    });
});
