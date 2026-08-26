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
 *
 * The RANK ANCHOR (below) is the one thing that adds resolution above the
 * band, and it is deliberately coarse: four tiers, none finer than 1%, and
 * nothing at all below the top quarter. That takes a group from 5 ordinal
 * levels to at most 8 — still far too blunt to fit a sigmoid against, and a
 * percentile of a monotone transform of public FPL inputs is computable by
 * anyone who cares to. Do not make the ladder finer, and do not emit the
 * percentile as a number the caller can interpolate.
 */

import type { GranularPosition, RatingBreakdownItem, RatingComponent, RawStats } from '@/types';
import {
    FEAT_GI_SATURATION_RAW,
    FEAT_GI_UNIT,
    POSITION_WEIGHTS,
} from './matchRating';

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
 * The probe that produced them is `scratch/band-distribution-probe.ts`, and
 * RANK_CUTS below goes stale at the same moment — refresh the pair together.
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

/* ══════════════════════════════════════════════════════════════════════════
   MUTE GROUPS — a row that cannot vary must not spend a row.

   Measured over 2025-26, the raw group score of `attacking` has this many
   DISTINCT VALUES across a whole season, with this share sitting on one:

     RB    5 values   89.7% identical      LWB  43 values  29.7%
     LB    6 values   89.6% identical      CM  121 values  27.9%
     DM    7 values   86.6% identical      AM  146 values  15.9%
     CB  216 values   28.6% identical      ST  928 values  12.5%

   The top three are not a banding problem and no percentile cut can fix them.
   Look at the weights: LB, RB and DM carry threat 0.00 and finishing 0.00, so
   their `attacking` group is `goal_involvement` ALONE — one near-binary
   component (goals×6 + assists×4, zero about nine games in ten) wearing a
   group's clothes. CB is the same shape with two near-binary members.

   So the rule is structural, not a per-position list: a group is MUTE-CAPABLE
   when every member the position actually weights is near-binary. It then
   renders only when it has something to say. Note what this does NOT catch —
   LWB, CM, ST and the rest all weight `threat`, which is continuous, so their
   attacking row varies honestly and always shows. A blanking striker still
   reads ANONYMOUS, which is the whole point of the row for a striker.

   This recomputes from POSITION_WEIGHTS, so it tracks a weight change on its
   own rather than going stale like a hardcoded list would. */

/** Components that are effectively blank-or-returned rather than continuous. */
const NEAR_BINARY: RatingComponent[] = ['goal_involvement', 'finishing'];

/** True when every weighted member of the group is near-binary, so the group
 *  has no continuous input and collapses onto its blank value. */
function isMuteCapable(key: PerfGroupKey, weights: Record<RatingComponent, number>): boolean {
    const weighted = GROUP_COMPONENTS[key].filter((c) => (weights[c] ?? 0) > 0);
    return weighted.length > 0 && weighted.every((c) => NEAR_BINARY.includes(c));
}

/**
 * Did this match give a mute-capable group anything to report?
 *
 * A goal or an assist obviously does. So does a real chance missed — xG with
 * no goal is exactly what `finishing` is there to judge, and "he got in and
 * did not take it" is worth a row. Nothing else can move the group.
 */
function hasSomethingToSay(s: RawStats): boolean {
    return n(s.goals) > 0 || n(s.assists) > 0 || n(s.expected_goals) >= 0.05;
}

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

/* ══════════════════════════════════════════════════════════════════════════
   RANK ANCHORS

   The band alone cannot separate the top of the top: `best` is the top ~15%,
   so every leading attacker in a gameweek reads "Decisive" and the block goes
   quiet exactly where a manager is looking hardest. The anchor is the fix —
   "TOP 1% FOR AN AM" beside "TOP 12% FOR AN AM" is the difference the band
   cannot draw.

   POOLED BY IDENTICAL WEIGHT VECTOR, not by position group. LB and RB carry
   the same eight weights, as do LWB/RWB and LW/RW, so their group scores are
   already on one scale and pooling them is free sample size — RWB alone has
   222 appearances, which is not enough to speak about a 1% tail. Positions
   with a distinct weight vector are never pooled, because their scores are
   not comparable. The anchor still names the player's OWN position.

   TIE-SAFE THRESHOLDS, not plain quantiles. Measured over 2025-26, CB
   attacking has p50 = p75 = p90 = 0.513 — the blanks all score identically —
   so `score >= p90` would have decorated 40% of centre-backs with "Top 10%".
   Each cut is instead the smallest observed value whose tail is AT MOST the
   claimed share, so the label never overstates. Where a tie block forces the
   achieved share below half the label the tier is dropped to `null` and the
   tier above speaks instead; that is why `attacking` has four holes and no
   other group has any.

   REFRESH THESE WITH BAND_CUTS — same reason, and the same moment: both
   describe a distribution that regenerating rating_reference_stats moves.
   The probe is `scratch/rank-anchor-probe.ts`; its header says how to run it
   and what hand pass its output still needs. */

const RANK_LABELS = [25, 10, 5, 1] as const;

/** Buckets sharing one weight vector. Anything absent stands alone. */
const RANK_BUCKET: Partial<Record<GranularPosition, string>> = {
    LB: 'LB/RB', RB: 'LB/RB',
    LWB: 'LWB/RWB', RWB: 'LWB/RWB',
    LW: 'LW/RW', RW: 'LW/RW',
};

/** Score at or above which each of RANK_LABELS holds. `null` = tier dropped. */
const RANK_CUTS: Record<string, Partial<Record<PerfGroupKey, (number | null)[]>>> = {
    AM:        { attacking: [0.634, 0.814, 0.883, 0.975], creating: [0.608, 0.801, 0.882, 0.975], involvement: [0.602, 0.796, 0.864, 0.947] },
    CB:        { attacking: [null, 0.657, 0.834, 0.942], creating: [0.641, 0.851, 0.907, 0.985], defending: [0.646, 0.847, 0.891, 0.932], involvement: [0.658, 0.811, 0.857, 0.918] },
    CM:        { attacking: [0.613, 0.741, 0.865, 0.941], creating: [0.579, 0.776, 0.866, 0.965], defending: [0.594, 0.762, 0.828, 0.921], involvement: [0.593, 0.723, 0.827, 0.935] },
    DM:        { attacking: [0.832, 0.917, null, 0.982], creating: [0.600, 0.797, 0.874, 0.975], defending: [0.621, 0.826, 0.879, 0.939], involvement: [0.589, 0.737, 0.824, 0.934] },
    GK:        { shotStopping: [0.650, 0.787, 0.794, 0.892], goalsPrevented: [0.821, 0.874, 0.889, 0.918], involvement: [0.672, 0.777, 0.841, 0.931] },
    'LB/RB':   { attacking: [null, null, 0.917, 0.961], creating: [0.607, 0.783, 0.866, 0.964], defending: [0.673, 0.843, 0.884, 0.932], involvement: [0.650, 0.800, 0.842, 0.908] },
    'LW/RW':   { attacking: [0.498, 0.835, 0.887, 0.943], creating: [0.597, 0.779, 0.857, 0.955], involvement: [0.575, 0.747, 0.826, 0.939] },
    'LWB/RWB': { attacking: [0.554, 0.703, 0.784, 0.953], creating: [0.619, 0.818, 0.910, 0.987], defending: [0.604, 0.807, 0.864, 0.915], involvement: [0.631, 0.791, 0.860, 0.934] },
    ST:        { attacking: [0.569, 0.798, 0.861, 0.969], creating: [0.642, 0.779, 0.869, 0.966], involvement: [0.562, 0.797, 0.863, 0.966] },
};

/** "an AM" / "a CB". The string is CSS-uppercased at render. */
const POS_ARTICLE: Record<GranularPosition, string> = {
    GK: 'a', CB: 'a', LB: 'an', RB: 'an', LWB: 'an', RWB: 'an',
    DM: 'a', CM: 'a', AM: 'an', LW: 'an', RW: 'an', ST: 'an',
};

/**
 * The rank anchor for one group score, or undefined when it says nothing.
 *
 * Silent below the top quarter — by design. "Bottom 40%" is unpleasant
 * without being actionable, and between the median and the top quarter the
 * band has already said everything a percentile would.
 */
export function rankAnchor(
    score: number,
    position: GranularPosition,
    group: PerfGroupKey,
): string | undefined {
    const cuts = RANK_CUTS[RANK_BUCKET[position] ?? position]?.[group];
    if (!cuts) return undefined;
    // Tightest tier first — "Top 1%" outranks "Top 25%" for the same score.
    for (let i = cuts.length - 1; i >= 0; i--) {
        const cut = cuts[i];
        if (cut !== null && cut !== undefined && score >= cut) {
            return `Top ${RANK_LABELS[i]}% for ${POS_ARTICLE[position]} ${position}`;
        }
    }
    return undefined;
}

export interface PerfGroup {
    key: PerfGroupKey;
    label: string;
    band: PerfBand;
    /** Bar width in percent, quantised to the band. */
    width: number;
    verdict: string;
    /** Public raw facts. Free to publish — they are already on the FPL site. */
    evidence: string;
    /** e.g. "Top 5% for an AM". Absent below the top quarter, and on a feat
     *  row — a feat is rarer than 1%, so an anchor there understates it. */
    rank?: string;
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
        // Nor does one that structurally cannot vary and has nothing to report
        // this week — see the MUTE GROUPS note above.
        if (isMuteCapable(key, weights) && !hasSomethingToSay(stats)) continue;

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
            const goalFeat =
                n(stats.goals) * FEAT_GI_UNIT + n(stats.assists) * 4 > FEAT_GI_SATURATION_RAW;
            const owns = key === 'attacking' ? goalFeat : !goalFeat;
            if (owns) band = featExcess >= 2 ? 'feat2' : 'feat';
        }

        const isFeat = band === 'feat' || band === 'feat2';
        out.push({
            key,
            label: GROUP_LABEL[key],
            band,
            width: BAND_WIDTH[band],
            verdict: VERDICTS[key][BAND_INDEX[band]],
            evidence: evidenceFor(key, stats),
            rank: isFeat ? undefined : rankAnchor(score, position, key),
        });
    }
    return out;
}
