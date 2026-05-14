/**
 * Gaffa — Match Rating Engine V1 (Frozen Snapshot)
 *
 * This is a FROZEN copy of the pre-Phase-1-rebalance scoring engine. It exists
 * solely so that the live engine (`matchRating.ts`) can be dual-written
 * alongside V1 during the Phase 3 shadow-validation window. After Phase 3D
 * promotion, this file is deleted.
 *
 * Do NOT modify this file. It captures historical behavior:
 *   - Defensive raw input = tackleCurve + cbiCurve + recoveriesCurve
 *     (using FPL granular fields hard-zeroed at sync time, so in practice ~0)
 *   - Defensive sigmoid baseline: hardcoded {median: 0.2, stddev: 2.8} for
 *     every position (these were the values in DEFAULT_REFERENCE_STATS and in
 *     the production `rating_reference_stats` table before Phase 1D).
 *   - No `defensive_contribution` field — 25/26 FPL stat ignored.
 *   - Position weights & flex unchanged from the current engine (Phase 1 did
 *     not retune weights — that's Phase 4 territory).
 *
 * The pipeline (sigmoidNormalize → applyPositionWeights → curveFinalRating →
 * calculateFantasyPoints) is shared with the live engine via imports.
 */

import {
    FLEX_CONFIG,
    POSITION_WEIGHTS,
    applyPositionWeights,
    curveFinalRating,
    calculateFantasyPoints,
} from './matchRating';
import type {
    GranularPosition,
    RawStats,
    MatchRating,
    RatingBreakdownItem,
    RatingComponent,
    PositionGroup,
    ReferenceStats,
} from '@/types';

type ComponentScores = Record<RatingComponent, number>;

const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

function getPositionGroupV1(pos: GranularPosition): PositionGroup {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') return 'DEF';
    if (pos === 'DM' || pos === 'CM' || pos === 'AM') return 'MID';
    return 'ATT';
}

const COMPONENT_DISPLAY: Record<RatingComponent, string> = {
    match_impact: 'Match Impact',
    influence: 'Influence',
    creativity: 'Creativity',
    threat: 'Threat',
    defensive: 'Defensive',
    goal_involvement: 'Goal Involvement',
    finishing: 'Finishing',
    save_score: 'Save Score',
};

interface ComponentResult {
    score: number;
    detail: string;
}

function makeRef(
    mi: [number, number], inf: [number, number], cre: [number, number],
    thr: [number, number], def: [number, number],
    gi: [number, number], fin: [number, number], sav: [number, number],
): ReferenceStats {
    return {
        match_impact: { median: mi[0], stddev: mi[1] },
        influence: { median: inf[0], stddev: inf[1] },
        creativity: { median: cre[0], stddev: cre[1] },
        threat: { median: thr[0], stddev: thr[1] },
        defensive: { median: def[0], stddev: def[1] },
        goal_involvement: { median: gi[0], stddev: gi[1] },
        finishing: { median: fin[0], stddev: fin[1] },
        save_score: { median: sav[0], stddev: sav[1] },
    };
}

// FROZEN: the DEFAULT_REFERENCE_STATS values that were active before Phase 1D
// recomputed them from real production data. Defensive baseline was hardcoded
// to {0.2, 2.8} for every position — the broken baseline this whole rebalance
// is correcting.
const DEFAULT_REFERENCE_STATS_V1: Record<GranularPosition, ReferenceStats> = {
    GK:  makeRef([14,    9.30], [21.8,  14.28], [ 0.00,  3.17], [ 0.00,  1.51], [ 0.2,  2.8], [0.00, 0.48], [ 0.00, 1.00], [6.00, 4.03]),
    CB:  makeRef([12,    8.72], [18.2,  11.82], [ 1.80, 10.60], [ 2.00,  9.81], [ 0.2,  2.8], [0.00, 1.59], [ 0.00, 1.00], [0.00, 0.92]),
    LB:  makeRef([10,    9.12], [14.8,  11.20], [10.30, 14.04], [ 4.00,  9.59], [ 0.2,  2.8], [0.00, 1.70], [-0.01, 1.00], [0.00, 1.00]),
    RB:  makeRef([12,    9.30], [14.2,  11.53], [ 9.50, 12.92], [ 2.00,  8.06], [ 0.2,  2.8], [0.00, 1.82], [ 0.00, 1.00], [0.00, 1.00]),
    DM:  makeRef([12,    6.54], [13.0,  12.62], [10.10, 13.09], [ 2.00, 10.22], [ 0.2,  2.8], [0.00, 1.95], [-0.01, 1.00], [0.00, 1.36]),
    CM:  makeRef([11,    6.69], [12.2,  15.78], [14.20, 17.75], [ 8.00, 14.92], [ 0.2,  2.8], [0.00, 2.76], [-0.01, 0.11], [0.00, 1.00]),
    LWB: makeRef([10,    8.50], [13.0,  12.00], [12.00, 15.00], [ 6.00, 11.00], [ 0.2,  2.8], [0.00, 2.20], [-0.01, 0.50], [0.00, 1.00]),
    RWB: makeRef([11,    8.50], [12.5,  12.00], [11.00, 14.00], [ 4.00, 10.00], [ 0.2,  2.8], [0.00, 2.20], [ 0.00, 0.50], [0.00, 1.00]),
    AM:  makeRef([10,    7.47], [12.0,  19.40], [15.90, 17.88], [10.00, 16.43], [ 0.2,  2.8], [0.00, 3.46], [-0.01, 0.13], [0.00, 1.04]),
    LW:  makeRef([10,    7.46], [10.6,  19.21], [15.95, 16.70], [19.50, 18.50], [ 0.2,  2.8], [0.00, 3.69], [-0.02, 0.15], [0.00, 1.00]),
    RW:  makeRef([ 9,    7.45], [11.8,  19.08], [16.30, 17.59], [19.00, 18.11], [ 0.2,  2.8], [0.00, 3.48], [-0.01, 0.14], [0.00, 1.00]),
    ST:  makeRef([ 6,    9.22], [ 8.2,  21.49], [10.80, 11.29], [21.00, 22.13], [ 0.2,  2.8], [0.00, 3.92], [-0.02, 0.15], [0.00, 1.00]),
};

function computeComponentScoresV1(
    stats: RawStats,
    position: GranularPosition,
): Record<RatingComponent, ComponentResult> {
    const ref = DEFAULT_REFERENCE_STATS_V1[position] ?? DEFAULT_REFERENCE_STATS_V1.CM;

    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);
    const matchImpact: ComponentResult = {
        score: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        detail: `BPS: ${rawBps} (adj: ${adjustedBps})`,
    };

    const infl = stats.influence ?? 0;
    const influence: ComponentResult = {
        score: sigmoidNormalize(infl, ref.influence.median, ref.influence.stddev),
        detail: `${infl.toFixed(1)}`,
    };

    const cre = stats.creativity ?? 0;
    const creativity: ComponentResult = {
        score: sigmoidNormalize(cre, ref.creativity.median, ref.creativity.stddev),
        detail: `${cre.toFixed(1)}`,
    };

    const thr = stats.threat ?? 0;
    const threat: ComponentResult = {
        score: sigmoidNormalize(thr, ref.threat.median, ref.threat.stddev),
        detail: `${thr.toFixed(1)}`,
    };

    // V1 defensive: pre-Phase-1 formula. Granular fields were hard-zeroed at
    // sync time, so in production the curves below summed to 0 and only
    // csBonus / xgcOutperf / gcPenalty drove the score.
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const posGroup = getPositionGroupV1(position);
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (posGroup === 'GK' || posGroup === 'DEF' || position === 'DM') {
            csBonus = 12;
        } else if (position === 'CM') {
            csBonus = 4;
        }
    }
    const canGetCS = csBonus > 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;
    // V1 hard-zeros granular defensive inputs to reproduce the historical
    // behavior where mapFplLiveToRawStats did the same. fpl_def_contrib is
    // simply ignored (it didn't exist).
    const v1Tackles = 0;
    const v1Cbi = 0;
    const v1Recoveries = 0;
    const tackleCurve = Math.pow(v1Tackles, 0.8) * 1.5;
    const recoveriesCurve = Math.pow(v1Recoveries, 0.7) * 0.8;
    const cbiCurve = position === 'CB'
        ? Math.pow(v1Cbi, 0.6) * 1.2
        : Math.pow(v1Cbi, 0.8) * 1.2;
    const defActionsRaw = tackleCurve + cbiCurve + recoveriesCurve;
    const defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;
    const defensive: ComponentResult = {
        score: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        detail: (stats.clean_sheet && canGetCS)
            ? `CS, ${gc} conceded vs ${xgc.toFixed(1)} xGC`
            : `${gc} conceded vs ${xgc.toFixed(1)} xGC`,
    };

    const giRaw = stats.goals * 6 + stats.assists * 4;
    const goalInvolvement: ComponentResult = {
        score: sigmoidNormalize(giRaw, ref.goal_involvement.median, ref.goal_involvement.stddev),
        detail: `${stats.goals}G, ${stats.assists}A`,
    };

    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const xgOutperf = stats.goals - xg;
    const xaOutperf = stats.assists - xa;
    const finInput = xgOutperf + xaOutperf * 0.5;
    const finishing: ComponentResult = {
        score: sigmoidNormalize(finInput, ref.finishing.median, ref.finishing.stddev),
        detail: `${xgOutperf >= 0 ? '+' : ''}${xgOutperf.toFixed(2)} vs xG, ${xaOutperf >= 0 ? '+' : ''}${xaOutperf.toFixed(2)} vs xA`,
    };

    let saveScore: ComponentResult;
    if (position === 'GK') {
        const sv = stats.saves;
        const psav = stats.penalty_saves;
        const saveRaw = sv * 2 + psav * 5 - Math.max(0, gc - xgc) * 2;
        saveScore = {
            score: sigmoidNormalize(saveRaw, ref.save_score.median, ref.save_score.stddev),
            detail: `${sv} save(s)${psav > 0 ? `, ${psav} pen save(s)` : ''}`,
        };
    } else {
        saveScore = { score: 0.5, detail: '—' };
    }

    return {
        match_impact: matchImpact,
        influence,
        creativity,
        threat,
        defensive,
        goal_involvement: goalInvolvement,
        finishing,
        save_score: saveScore,
    };
}

/**
 * Run the V1 (legacy, frozen) match-rating engine. Returns the same MatchRating
 * shape as `calculateMatchRating`. Reference stats are baked in — the live DB
 * `rating_reference_stats` table is NOT consulted, by design.
 */
export function calculateMatchRatingV1(
    stats: RawStats,
    position: GranularPosition,
): MatchRating {
    if (stats.minutes_played === 0) {
        return {
            rating: 0,
            fantasyPoints: 0,
            breakdown: [],
            position,
        };
    }

    const componentResults = computeComponentScoresV1(stats, position);
    const scores: ComponentScores = {
        match_impact: componentResults.match_impact.score,
        influence: componentResults.influence.score,
        creativity: componentResults.creativity.score,
        threat: componentResults.threat.score,
        defensive: componentResults.defensive.score,
        goal_involvement: componentResults.goal_involvement.score,
        finishing: componentResults.finishing.score,
        save_score: componentResults.save_score.score,
    };

    const { composite, breakdown } = applyPositionWeights(scores, position);
    const rating = curveFinalRating(composite, stats.minutes_played);
    const fantasyPoints = calculateFantasyPoints(rating, stats.minutes_played);

    const fullBreakdown: RatingBreakdownItem[] = breakdown.map((item) => {
        const compKey = item.key as RatingComponent;
        const detail = componentResults[compKey]?.detail ?? '';
        return { ...item, detail };
    });

    return {
        rating,
        fantasyPoints,
        breakdown: fullBreakdown,
        position,
    };
}

// Silence unused warnings for re-exports retained for completeness
void FLEX_CONFIG;
void POSITION_WEIGHTS;
void COMPONENT_DISPLAY;
