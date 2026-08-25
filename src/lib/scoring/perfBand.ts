/**
 * Gaffa — the performance block's data layer.
 *
 * Turns the engine's eight-component breakdown into the four (or three)
 * display groups a manager actually reads. Design and reasoning:
 * `Gaffa 2.0 Performance Block` in the Claude Design system project.
 *
 * THE DISCLOSURE RULE THIS FILE EXISTS TO ENFORCE.
 * Gaffa's scoring is calibrated, not derived. Publishing per-component scores
 * alongside the public FPL inputs that produced them would let anyone fit the
 * sigmoid and then solve the weights — so the wire format is BANDS, never
 * scores. `buildPerformanceGroups` is meant to run on the SERVER and the raw
 * composite must not travel with its output. Quantising the bar in CSS is
 * theatre if the score arrives beside it in the JSON.
 *
 * Three rules follow from that, and each is easy to undo by accident:
 *
 *  1. Never widen `PerfGroup` to carry the numeric score.
 *  2. Never order groups by weighted contribution — that publishes the weight
 *     ordering. Order is fixed per position (GROUP_ORDER below).
 *  3. Never mark which component won the flex boost.
 */

import type { GranularPosition, RatingBreakdownItem, RatingComponent, RawStats } from '@/types';
import { POSITION_WEIGHTS } from './matchRating';

export type PerfBand = 'poor' | 'low' | 'mid' | 'good' | 'best' | 'feat' | 'feat2';

/**
 * Band cuts, PER GROUP, derived from the real 2025-26 distribution
 * (11,355 scoring appearances). Cuts sit at p15 / p35 / p65 / p85, so each
 * band is a meaningful share rather than a round number.
 *
 * WHY NOT FIXED CUTS AT 34/44/55/69. That was the first design and it does not
 * survive contact with the data, because these scores are sigmoids centred on
 * a positional MEDIAN — half the population sits below 0.5 by construction and
 * the mass piles up around it. Measured under the old cuts:
 *
 *   attacking    poor 0.0%  low 0.0%  mid 74.9%  good 5.2%  best 19.9%
 *   involvement  ...                                        best 26.4%
 *
 * Three quarters of every attacking performance read the same word, and a
 * quarter of all involvement rows read "Everywhere". Duke spotted it straight
 * away from the live page: the best attackers of the week all graded
 * "Decisive / Masterful / Everywhere", so the block could not separate the top
 * performances from each other at all.
 *
 * Percentile cuts also make the band itself a RANK statement, which is both
 * more informative and no more disclosive — the percentile of a monotone
 * transform of public FPL inputs is already computable by anyone.
 *
 * REFRESH THESE when rating_reference_stats is regenerated for a new season;
 * they are distribution-dependent the same way the reference medians are.
 * The probe that produced them is in the handoff.
 */
const BAND_CUTS: Record<PerfGroupKey, [number, number, number, number]> = {
    attacking:      [0.438, 0.483, 0.620, 0.750],
    creating:       [0.323, 0.381, 0.527, 0.731],
    involvement:    [0.293, 0.375, 0.530, 0.725],
    defending:      [0.303, 0.379, 0.537, 0.783],
    shotStopping:   [0.225, 0.408, 0.594, 0.709],
    goalsPrevented: [0.376, 0.453, 0.535, 0.862],
};

/** Ordinary bands only. The feat tiers are set by the feat trigger, not here. */
export function perfBand(score: number, group: PerfGroupKey): Exclude<PerfBand, 'feat' | 'feat2'> {
    const [a, b, c, d] = BAND_CUTS[group];
    if (score < a) return 'poor';
    if (score < b) return 'low';
    if (score < c) return 'mid';
    if (score < d) return 'good';
    return 'best';
}

/** Quantised bar geometry — the band IS the width. Mid sits on the median tick. */
export const BAND_WIDTH: Record<PerfBand, number> = {
    poor: 16, low: 34, mid: 50, good: 68, best: 88, feat: 100, feat2: 100,
};

export type PerfGroupKey =
    | 'attacking' | 'creating' | 'defending' | 'involvement'
    | 'shotStopping' | 'goalsPrevented';

const GROUP_COMPONENTS: Record<PerfGroupKey, RatingComponent[]> = {
    attacking: ['goal_involvement', 'finishing', 'threat'],
    creating: ['creativity'],
    defending: ['defensive', 'save_score'],
    involvement: ['match_impact', 'influence'],
    shotStopping: ['save_score'],
    goalsPrevented: ['defensive'],
};

const GROUP_LABEL: Record<PerfGroupKey, string> = {
    attacking: 'Attacking',
    creating: 'Creating',
    defending: 'Defending',
    involvement: 'Involvement',
    shotStopping: 'Shot-stopping',
    goalsPrevented: 'Goals prevented',
};

/**
 * Fixed per position — never sorted by contribution. A keeper runs an entirely
 * different map: `save_score` and `defensive` measure genuinely different
 * things in goal, and the two groups that lead the outfield map are weight-zero
 * for him. Attacking/Creating are simply absent for a keeper, and Defending is
 * absent for AM/LW/RW/ST, because those weights are 0.00 — that absence is the
 * clearest statement the block makes.
 */
const GROUP_ORDER: Record<GranularPosition, PerfGroupKey[]> = {
    GK: ['shotStopping', 'goalsPrevented', 'involvement'],
    CB: ['defending', 'involvement', 'attacking', 'creating'],
    LB: ['defending', 'involvement', 'creating', 'attacking'],
    RB: ['defending', 'involvement', 'creating', 'attacking'],
    LWB: ['defending', 'creating', 'involvement', 'attacking'],
    RWB: ['defending', 'creating', 'involvement', 'attacking'],
    DM: ['involvement', 'defending', 'creating', 'attacking'],
    CM: ['involvement', 'creating', 'attacking', 'defending'],
    AM: ['attacking', 'creating', 'involvement'],
    LW: ['attacking', 'creating', 'involvement'],
    RW: ['attacking', 'creating', 'involvement'],
    ST: ['attacking', 'creating', 'involvement'],
};

/** Verdict vocabulary. Index 0-4 are the ordinary bands; 5 and 6 are the feats. */
const VERDICTS: Record<PerfGroupKey, string[]> = {
    attacking:      ['Anonymous', 'Quiet', 'Involved', 'Dangerous', 'Decisive', 'Devastating', 'Unplayable'],
    creating:       ['Static', 'Tidy', 'Inventive', 'Incisive', 'Masterful', 'Virtuoso', 'Virtuoso'],
    defending:      ['Overrun', 'Passive', 'Steady', 'Assured', 'Commanding', 'Commanding', 'Commanding'],
    involvement:    ['Peripheral', 'Quiet', 'Busy', 'Influential', 'Everywhere', 'Everywhere', 'Everywhere'],
    shotStopping:   ['Beaten', 'Shaky', 'Steady', 'Sharp', 'Inspired', 'Inspired', 'Inspired'],
    goalsPrevented: ['Breached', 'Exposed', 'Held', 'Protected', 'Impassable', 'Impassable', 'Impassable'],
};

const BAND_INDEX: Record<PerfBand, number> = {
    poor: 0, low: 1, mid: 2, good: 3, best: 4, feat: 5, feat2: 6,
};

export interface PerfGroup {
    key: PerfGroupKey;
    label: string;
    band: PerfBand;
    /** Bar width in percent, quantised to the band. */
    width: number;
    verdict: string;
    /** Public raw facts. Free to publish — they are already on the FPL site. */
    evidence: string;
}

const n = (v: unknown) => Number(v ?? 0);

/** Prose from the public stat line. Never a score, never a weight.
 *
 * MEASURED AGAINST THE REAL TABLE, not against what RawStats advertises.
 * `key_passes` is present on every row and is ZERO on every row — 14,521 of
 * 14,521 in 2025-26 and 609 of 609 in 2026-27 — because FPL's element-summary
 * never fills it. A first draft of this file used it for the Creating line and
 * every single player, at every band, read "No chances created." underneath a
 * verdict of MASTERFUL. Anything added here needs checking against the table
 * first. (`MatchupPitch.fmtStats` still reads the same dead field for its
 * CMZ/AMZ chips — a separate, pre-existing bug.)
 *
 * What IS populated, over 11,355 scoring appearances in 2025-26: creativity
 * 10,091, xGC 10,906, bps 10,403, recoveries 9,528, CBI 8,100, xA 7,855,
 * tackles 6,252, xG 5,327, saves 710.
 */
function evidenceFor(key: PerfGroupKey, s: RawStats): string {
    const goals = n(s.goals), assists = n(s.assists);
    const xg = n(s.expected_goals), xa = n(s.expected_assists);
    switch (key) {
        case 'attacking': {
            const parts: string[] = [];
            if (goals) parts.push(goals === 1 ? 'One goal' : `${goals} goals`);
            if (assists) parts.push(assists === 1 ? 'an assist' : `${assists} assists`);
            if (parts.length) {
                const head = `${parts.join(' and ')}`;
                return xg >= 0.05 ? `${head}, from ${xg.toFixed(2)} expected goals.` : `${head}.`;
            }
            // No return, but the chances were there — worth saying, because it
            // is the difference between a bad game and an unlucky one.
            if (xg >= 0.3) return `No goal, but ${xg.toFixed(2)} expected — the chances came.`;
            return 'No goals or assists.';
        }
        case 'creating': {
            if (assists) {
                const head = assists === 1 ? 'One assist' : `${assists} assists`;
                return xa >= 0.05 ? `${head}, from ${xa.toFixed(2)} expected.` : `${head}.`;
            }
            if (xa >= 0.05) return `No assist, but created ${xa.toFixed(2)} expected assists.`;
            return 'Little creative output.';
        }
        case 'defending': {
            const bits: string[] = [];
            if (s.clean_sheet) bits.push('Clean sheet');
            const tk = n(s.fpl_tackles), cbi = n(s.fpl_cbi), rec = n(s.fpl_recoveries);
            const acts: string[] = [];
            if (tk) acts.push(`${tk} ${tk === 1 ? 'tackle' : 'tackles'}`);
            if (cbi) acts.push(`${cbi} ${cbi === 1 ? 'clearance' : 'clearances'}`);
            if (rec) acts.push(`${rec} ${rec === 1 ? 'recovery' : 'recoveries'}`);
            if (acts.length) bits.push(acts.join(', '));
            return bits.length ? `${bits.join('. ')}.` : 'Little defensive work.';
        }
        case 'shotStopping': {
            const sv = n(s.saves), psv = n(s.penalty_saves);
            if (!sv) return 'No saves to make.';
            const base = sv === 1 ? 'One save' : `${sv} saves`;
            return psv
                ? `${base}, ${psv === 1 ? 'one of them from the penalty spot' : `${psv} from the spot`}.`
                : `${base}.`;
        }
        case 'goalsPrevented': {
            const gc = n(s.goals_conceded);
            const xgc = n(s.expected_goals_conceded);
            const cs = s.clean_sheet ? 'Clean sheet. ' : '';
            if (xgc < 0.05) return `${cs}${gc} conceded.`;
            return `${cs}${gc === 0 ? 'None' : gc} conceded against ${xgc.toFixed(1)} expected.`;
        }
        case 'involvement': {
            // Only speaks when it explains something. A 90-minute starter needs
            // no line — "90 minutes on the pitch" every week is noise — but a
            // short outing is most of why the band is what it is.
            const mins = n(s.minutes_played);
            if (mins > 0 && mins < 60) return `Only ${mins} minutes on the pitch.`;
            return '';
        }
        default:
            return '';
    }
}

/**
 * Build the display groups for one match.
 *
 * `featExcess` mirrors the engine's rare-feat excess — pass 0 when no feat
 * fired. It promotes the relevant group past the ordinary scale rather than
 * adding a colour stop.
 */
export function buildPerformanceGroups(
    breakdown: RatingBreakdownItem[],
    position: GranularPosition,
    stats: RawStats,
    featExcess = 0,
): PerfGroup[] {
    const scoreOf = new Map<RatingComponent, number>();
    for (const item of breakdown) scoreOf.set(item.key, item.score);

    const weights = POSITION_WEIGHTS[position] ?? POSITION_WEIGHTS.CM;
    const order = GROUP_ORDER[position] ?? GROUP_ORDER.CM;

    const out: PerfGroup[] = [];
    for (const key of order) {
        const members = GROUP_COMPONENTS[key];
        // A group the position is not graded on does not appear at all.
        const weight = members.reduce((sum, c) => sum + (weights[c] ?? 0), 0);
        if (weight <= 0) continue;

        // WEIGHTED MEAN of the members, not the max. Max was the first design
        // and it let one saturated component speak for the whole group — for
        // an attacker, goal_involvement is near-binary (blank or returned), so
        // taking the max collapsed Attacking onto two values and 75% of all
        // appearances read the same verdict.
        const score = members.reduce((acc, c) => acc + (scoreOf.get(c) ?? 0) * (weights[c] ?? 0), 0) / weight;
        let band: PerfBand = perfBand(score, key);

        // The feat tiers sit above the ordinary scale and only the trigger can
        // reach them. Attacking owns the goal feat; Creating owns the creative
        // one. Never both in the same match — no appearance in 2025-26 fired
        // both triggers.
        if (featExcess > 0 && (key === 'attacking' || key === 'creating')) {
            const goalFeat = n(stats.goals) * 6 + n(stats.assists) * 4 > 11.5;
            const owns = key === 'attacking' ? goalFeat : !goalFeat;
            if (owns) band = featExcess >= 2 ? 'feat2' : 'feat';
        }

        out.push({
            key,
            label: GROUP_LABEL[key],
            band,
            width: BAND_WIDTH[band],
            verdict: VERDICTS[key][BAND_INDEX[band]],
            evidence: evidenceFor(key, stats),
        });
    }
    return out;
}
