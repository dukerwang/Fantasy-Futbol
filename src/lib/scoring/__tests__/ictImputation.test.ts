import { describe, it, expect } from 'vitest';
import {
    imputeIct,
    applyIctImputation,
    isIctBlockAbsent,
    bucketFor,
} from '../ictImputation';
import { extractFeatures, FEATURE_COUNT } from '../ictFeatures';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../matchRating';
import type { GranularPosition } from '@/types';

const POSITIONS: GranularPosition[] = [
    'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST',
];

/** A plausible 90-minute outfield line with no ICT block, as FPL now serves it. */
function appearance(overrides: Record<string, unknown> = {}) {
    return {
        minutes_played: 90,
        goals: 0,
        assists: 0,
        expected_goals: 0.1,
        expected_assists: 0.1,
        expected_goals_conceded: 1.0,
        saves: 0,
        bps: 20,
        fpl_tackles: 2,
        fpl_cbi: 3,
        fpl_recoveries: 5,
        fpl_def_contrib: 1,
        goals_conceded: 1,
        yellow_cards: 0,
        red_cards: 0,
        own_goals: 0,
        penalties_missed: 0,
        penalty_saves: 0,
        clean_sheet: false,
        influence: 0,
        creativity: 0,
        threat: 0,
        ict_index: 0,
        ...overrides,
    };
}

describe('extractFeatures', () => {
    it('produces exactly FEATURE_COUNT values', () => {
        expect(extractFeatures(appearance())).toHaveLength(FEATURE_COUNT);
    });

    it('never reads the metrics it is meant to predict', () => {
        const withIct = appearance({ influence: 55, creativity: 40, threat: 30, ict_index: 12.5 });
        expect(extractFeatures(withIct)).toEqual(extractFeatures(appearance()));
    });

    it('treats missing keys as zero rather than NaN', () => {
        for (const v of extractFeatures({ minutes_played: 90 })) {
            expect(Number.isFinite(v)).toBe(true);
        }
    });
});

describe('bucketFor', () => {
    it('resolves every tactical position to a fitted model', () => {
        for (const pos of POSITIONS) {
            expect(imputeIct(appearance(), pos)).not.toBeNull();
        }
    });

    it('falls back rather than throwing on an unknown position', () => {
        expect(typeof bucketFor('NOT_A_POSITION')).toBe('string');
        expect(imputeIct(appearance(), 'NOT_A_POSITION')).not.toBeNull();
    });
});

describe('imputeIct', () => {
    it('returns non-negative estimates for every position', () => {
        for (const pos of POSITIONS) {
            const est = imputeIct(appearance(), pos)!;
            for (const v of Object.values(est)) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    it('scales influence with bps, which is what drives it', () => {
        const low = imputeIct(appearance({ bps: 4 }), 'CM')!;
        const high = imputeIct(appearance({ bps: 45 }), 'CM')!;
        expect(high.influence).toBeGreaterThan(low.influence);
    });

    it('gives a goalscorer more threat than an anonymous game', () => {
        const quiet = imputeIct(appearance({ expected_goals: 0.02 }), 'ST')!;
        const busy = imputeIct(appearance({ goals: 1, expected_goals: 0.9, bps: 38 }), 'ST')!;
        expect(busy.threat).toBeGreaterThan(quiet.threat);
    });

    it('gives a creator more creativity than an anonymous game', () => {
        const quiet = imputeIct(appearance({ expected_assists: 0.0 }), 'AM')!;
        const busy = imputeIct(appearance({ assists: 1, expected_assists: 0.8, bps: 35 }), 'AM')!;
        expect(busy.creativity).toBeGreaterThan(quiet.creativity);
    });
});

describe('applyIctImputation', () => {
    it('marks the row so estimates are never mistaken for FPL data', () => {
        const out = applyIctImputation(appearance(), 'CM') as any;
        expect(out.ict_imputed).toBe(true);
        expect(out.influence).toBeGreaterThan(0);
    });

    it('keeps ict_index consistent with its three components', () => {
        const out = applyIctImputation(appearance({ bps: 30 }), 'AM') as any;
        const expected = Math.round(out.influence + out.creativity + out.threat) / 10;
        expect(out.ict_index).toBeCloseTo(expected, 5);
    });

    it('leaves a player with no minutes untouched', () => {
        const dnp = appearance({ minutes_played: 0, bps: 0 });
        const out = applyIctImputation(dnp, 'CM') as any;
        expect(out).toEqual(dnp);
        expect(out.ict_imputed).toBeUndefined();
    });

    it('does not mutate its input', () => {
        const input = appearance();
        applyIctImputation(input, 'ST');
        expect(input.influence).toBe(0);
        expect((input as any).ict_imputed).toBeUndefined();
    });
});

describe('isIctBlockAbsent', () => {
    it('is true when every player who featured reads zero', () => {
        expect(isIctBlockAbsent([
            { minutes: 90, ictIndex: 0 },
            { minutes: 45, ictIndex: 0 },
            { minutes: 0, ictIndex: 0 },
        ])).toBe(true);
    });

    it('is false as soon as one player has a real figure', () => {
        expect(isIctBlockAbsent([
            { minutes: 90, ictIndex: 0 },
            { minutes: 62, ictIndex: 8.4 },
        ])).toBe(false);
    });

    it('is false when nobody has played, so a pre-kickoff sync never imputes', () => {
        expect(isIctBlockAbsent([{ minutes: 0, ictIndex: 0 }])).toBe(false);
        expect(isIctBlockAbsent([])).toBe(false);
    });

    it('ignores unused players, who legitimately read zero', () => {
        expect(isIctBlockAbsent([
            { minutes: 90, ictIndex: 11.2 },
            { minutes: 0, ictIndex: 0 },
        ])).toBe(false);
    });
});

describe('effect on the rating engine', () => {
    // The bug this exists to fix: ICT carries 6% of a GK's weight and 50% of an
    // AM's, so zeroing it costs midfielders far more than defenders. Imputation
    // should lift the heavily-weighted positions most.
    it('lifts a midfielder more than a goalkeeper', () => {
        const stats = appearance({ bps: 35, clean_sheet: true, goals_conceded: 0, saves: 4 });
        const gain = (pos: GranularPosition) => {
            const zeroed = calculateMatchRating(stats as any, pos, DEFAULT_REFERENCE_STATS);
            const imputed = calculateMatchRating(
                applyIctImputation(stats, pos) as any, pos, DEFAULT_REFERENCE_STATS,
            );
            return imputed.rating - zeroed.rating;
        };
        expect(gain('AM')).toBeGreaterThan(gain('GK'));
        expect(gain('CM')).toBeGreaterThan(gain('CB'));
    });

    it('never drags a rating below what the zeroed block would give', () => {
        for (const pos of POSITIONS) {
            const stats = appearance({ bps: 25 });
            const zeroed = calculateMatchRating(stats as any, pos, DEFAULT_REFERENCE_STATS);
            const imputed = calculateMatchRating(
                applyIctImputation(stats, pos) as any, pos, DEFAULT_REFERENCE_STATS,
            );
            expect(imputed.rating).toBeGreaterThanOrEqual(zeroed.rating - 1e-9);
        }
    });
});
