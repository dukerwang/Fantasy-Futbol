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

export type PerfBand =
    | 'poor' | 'low' | 'mid' | 'good'
    /** top 15% for the position */ | 'best'
    /** top 5% */ | 'elite'
    /** top 1% */ | 'supreme'
    | 'feat' | 'feat2';

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
 * BAND_CUTS_BY_POS and ANCHOR_TIERS below go stale at the same moment —
 * refresh all three together.
 */
const BAND_CUTS: Record<PerfGroupKey, readonly number[]> = {
    attacking:      [0.4376, 0.4834, 0.5000, 0.6584, 0.8627, 0.9429],
    creating:       [0.3230, 0.3819, 0.5279, 0.7312, 0.8796, 0.9698],
    involvement:    [0.2926, 0.3753, 0.5299, 0.7251, 0.8427, 0.9315],
    defending:      [0.3028, 0.3791, 0.5373, 0.7839, 0.8788, 0.9285],
    shotStopping:   [0.2287, 0.4116, 0.6246, 0.7297, 0.7939, 0.8918],
    goalsPrevented: [0.3761, 0.4539, 0.5356, 0.8625, 0.8886, 0.9175],
};

/* ══════════════════════════════════════════════════════════════════════════
   PER-POSITION BAND CUTS — the override, and why one table was not enough.

   The league-wide table above gives each band its share ACROSS ALL POSITIONS,
   but the score it cuts is already positionally normalised by the sigmoid. For
   a position whose distribution is compressed, the two disagree and bands die.
   Measured over 2025-26, `creating` for a centre-back:

     poor 0%   low 0%   mid 64%   good 14%   best 22%

   A centre-back could not read below STEADY on Creating, and 36% of them read
   INCISIVE or MASTERFUL on a median raw FPL creativity of 10.7 — the same
   words an attacking midfielder needed 33.0 for. Duke found it from one row:
   a CB graded INCISIVE above the line "Little creative output." Nine of 43
   position+group pairs had at least one band under 3%.

   Cuts are tie-safe the same way ANCHOR_TIERS is, and pooled the same way
   (identical weight vectors share a bucket: LB/RB, LWB/RWB, LW/RW).

   WHY THIS IS AN OVERRIDE RATHER THAN A REPLACEMENT. Three pairs come out
   WORSE per-position, and they are the near-binary `attacking` groups the mute
   rule already exists for — CB, DM and LB/RB. Their cuts collapse onto a
   single value (DM and LB/RB land all four cuts on 0.8320), which would grade
   every surviving row either poor or best: a full-back with 0.3 xG and no goal
   would read ANONYMOUS where the league-wide table says INVOLVED, which is the
   truer word. So a per-position entry is used only when its four cuts are
   STRICTLY INCREASING; otherwise the league-wide table stands. 29 of 32 pairs
   qualify, and the 3 that do not are exactly the ones already known to be
   degenerate.

   REFRESH WITH BAND_CUTS AND ANCHOR_TIERS — all three describe the same
   distribution. Probe: scratch/band-distribution-probe.ts. */

/**
 * Positions that share a distribution bucket, because their eight weights are
 * IDENTICAL — so their group scores sit on one scale and pooling them is free
 * sample size. RWB alone has 222 appearances, which cannot speak about a 1%
 * tail or a p15 cut. A position with a distinct weight vector is never pooled,
 * because its scores are not comparable. Both BAND_CUTS_BY_POS and ANCHOR_TIERS
 * key on this; a table still names the player's OWN position in prose.
 */
const POS_BUCKET: Partial<Record<GranularPosition, string>> = {
    LB: 'LB/RB', RB: 'LB/RB',
    LWB: 'LWB/RWB', RWB: 'LWB/RWB',
    LW: 'LW/RW', RW: 'LW/RW',
};

const BAND_CUTS_BY_POS: Record<string, Partial<Record<PerfGroupKey, readonly number[]>>> = {
    AM:        { attacking: [0.4123, 0.4507, 0.5857, 0.7656, 0.8832, 0.9750], creating: [0.3110, 0.3677, 0.5152, 0.7307, 0.8815, 0.9751], involvement: [0.3064, 0.3676, 0.5168, 0.7367, 0.8641, 0.9474] },
    CB:        { creating: [0.4647, 0.4784, 0.5353, 0.8277, 0.9068, 0.9849], defending: [0.3307, 0.4075, 0.5527, 0.8121, 0.8913, 0.9321], involvement: [0.3051, 0.3967, 0.5629, 0.7699, 0.8565, 0.9185] },
    CM:        { attacking: [0.4466, 0.4677, 0.5429, 0.6854, 0.8653, 0.9406], creating: [0.2931, 0.3351, 0.5110, 0.6963, 0.8661, 0.9649], defending: [0.2846, 0.3577, 0.5018, 0.6972, 0.8282, 0.9211], involvement: [0.2387, 0.3122, 0.5181, 0.6734, 0.8273, 0.9347] },
    DM:        { creating: [0.3269, 0.3574, 0.5394, 0.7176, 0.8736, 0.9750], defending: [0.3054, 0.3729, 0.5241, 0.7794, 0.8788, 0.9388], involvement: [0.2326, 0.3343, 0.5225, 0.6762, 0.8241, 0.9343] },
    GK:        { shotStopping: [0.2287, 0.4116, 0.6246, 0.7297, 0.7939, 0.8918], goalsPrevented: [0.3761, 0.4539, 0.5356, 0.8625, 0.8886, 0.9175], involvement: [0.3214, 0.4455, 0.6067, 0.7475, 0.8411, 0.9309] },
    'LB/RB':   { creating: [0.3328, 0.3582, 0.5410, 0.7134, 0.8655, 0.9638], defending: [0.3026, 0.3739, 0.5552, 0.8008, 0.8845, 0.9320], involvement: [0.2970, 0.3641, 0.5591, 0.7535, 0.8415, 0.9084] },
    'LW/RW':   { attacking: [0.4282, 0.4664, 0.4803, 0.7437, 0.8869, 0.9428], creating: [0.2809, 0.3181, 0.5066, 0.7110, 0.8574, 0.9550], involvement: [0.2811, 0.3371, 0.4923, 0.6806, 0.8260, 0.9394] },
    'LWB/RWB': { attacking: [0.4792, 0.5000, 0.5370, 0.6281, 0.7840, 0.9531], creating: [0.3328, 0.3756, 0.5724, 0.7557, 0.9103, 0.9869], defending: [0.2908, 0.3490, 0.5039, 0.7631, 0.8635, 0.9145], involvement: [0.2982, 0.3555, 0.5260, 0.7374, 0.8600, 0.9343] },
    ST:        { attacking: [0.4294, 0.4366, 0.4834, 0.7646, 0.8606, 0.9689], creating: [0.3558, 0.3776, 0.5312, 0.7079, 0.8694, 0.9662], involvement: [0.3826, 0.4086, 0.4905, 0.7443, 0.8629, 0.9664] },
};

/**
 * The four cuts in force for one group at one position — the per-position
 * table where it is well-formed, the league-wide table otherwise.
 *
 * SINGLE SOURCE. `perfBand` and `rankAnchor` both read this, and that is what
 * stops the two from contradicting each other: the anchor's floor is literally
 * the band's `best` cut, not a separately-measured number that happens to be
 * near it. See the note on ANCHOR_TIERS.
 */
function cutsFor(
    group: PerfGroupKey,
    position?: GranularPosition,
): readonly number[] {
    const perPos = position
        ? BAND_CUTS_BY_POS[POS_BUCKET[position] ?? position]?.[group]
        : undefined;
    return perPos ?? BAND_CUTS[group];
}

/**
 * Ordinary bands only. The feat tiers are set by the feat trigger, not here.
 *
 * `position` is optional so an existing caller keeps working, but pass it
 * wherever it is known — without it a centre-back is graded on the whole
 * league's distribution, which is the bug BAND_CUTS_BY_POS exists to fix.
 */
export function perfBand(
    score: number,
    group: PerfGroupKey,
    position?: GranularPosition,
): Exclude<PerfBand, 'feat' | 'feat2'> {
    const [a, b, c, d, e, f] = cutsFor(group, position);
    if (score < a) return 'poor';
    if (score < b) return 'low';
    if (score < c) return 'mid';
    if (score < d) return 'good';
    if (score < e) return 'best';
    if (score < f) return 'elite';
    return 'supreme';
}

/** Quantised bar geometry — the band IS the width. Mid sits on the median tick. */
export const BAND_WIDTH: Record<PerfBand, number> = {
    poor: 16, low: 34, mid: 50, good: 68,
    best: 82, elite: 90, supreme: 96,
    feat: 100, feat2: 100,
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

/**
 * Verdict vocabulary. Nine slots: 0-6 are the ordinary bands, 7 and 8 are the
 * two rare-feat tiers, which sit ABOVE `supreme` and are reached only by the
 * feat trigger — never by percentile.
 *
 * SEVEN ORDINARY WORDS, NOT FIVE, AND WHY THE EXTRA TWO ARE AT THE TOP. With
 * five bands the top word covered the whole top 15%, so a top-1% game and a
 * top-15% game read identically — Palmer and Saka both DECISIVE on attacking
 * and both EVERYWHERE on involvement, with only a small grey anchor line
 * distinguishing them. The word is the loudest thing on the row; if it cannot
 * separate them, nothing on the row does. So poor/low/mid/good keep their
 * 15/20/30/20 spans and the old `best` splits into best (top 15-5%), elite
 * (top 5-1%) and supreme (top 1%).
 *
 * THE FEAT TIERS KEEP THEIR OWN WORDS. A first pass at the seven-band ladder
 * promoted `Devastating` and `Unplayable` into elite/supreme — which stole them
 * from the feat tiers and left a hat-trick reading the same word as a top-1%
 * percentile, in a different colour. The feat tiers are deliberately outside
 * the ordinary scale (blue and violet, plus the star mark) and they need
 * language that is outside it too. Only `attacking` and `creating` can ever
 * reach them, which is why every other group repeats its top word there.
 *
 * MID MUST STAY NEUTRAL. Every middle word is flat — Involved, Tidy, Steady,
 * Busy, Held. Creating's used to be "Inventive", praise in the average slot,
 * and a centre-back with 2.2 raw creativity read INVENTIVE directly above
 * "Little creative output."
 *
 * Keep every word at or under 11 characters: `.verdict` is a fixed 96px column
 * with `white-space: nowrap`.
 */
const VERDICTS: Record<PerfGroupKey, string[]> = {
    //                poor          low          mid       good           best          elite          supreme        | feat           feat2
    attacking:      ['Anonymous',  'Quiet',     'Involved', 'Dangerous',  'Decisive',   'Ruthless',    'Rampant',      'Devastating', 'Unplayable'],
    creating:       ['Static',     'Sideways',  'Tidy',     'Incisive',   'Masterful',  'Sublime',     'Mesmeric',     'Virtuoso',    'Magician'],
    defending:      ['Overrun',    'Passive',   'Steady',   'Assured',    'Commanding', 'Imperious',   'Colossal',     'Colossal',    'Colossal'],
    involvement:    ['Peripheral', 'Quiet',     'Busy',     'Influential','Everywhere', 'Immense',     'Talismanic',   'Talismanic',  'Talismanic'],
    shotStopping:   ['Beaten',     'Shaky',     'Steady',   'Sharp',      'Inspired',   'Unbeatable',  'Untouchable',  'Untouchable', 'Untouchable'],
    goalsPrevented: ['Breached',   'Exposed',   'Held',     'Protected',  'Impassable', 'Impregnable', 'Unbreached',   'Unbreached',  'Unbreached'],
};

const BAND_INDEX: Record<PerfBand, number> = {
    poor: 0, low: 1, mid: 2, good: 3, best: 4, elite: 5, supreme: 6,
    feat: 7, feat2: 8,
};

/* ══════════════════════════════════════════════════════════════════════════
   RANK ANCHORS

   The band alone cannot separate the top of the top: `best` is the top ~15%,
   so every leading attacker in a gameweek reads "Decisive" and the block goes
   quiet exactly where a manager is looking hardest. The anchor is the fix —
   "TOP 1% FOR AN AM" beside "TOP 12% FOR AN AM" is the difference the band
   cannot draw.

   Pooled by POS_BUCKET, exactly like the band cuts above.

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

/**
 * The share each top band represents. These ARE the band boundaries — p85, p95
 * and p99 — so the anchor cannot disagree with the verdict beside it.
 *
 * This used to be its own measured table (`ANCHOR_TIERS`, and `RANK_CUTS`
 * before that) cut at p75/p90/p95/p99, which had no boundary in common with
 * the bands at p85. The `best` band therefore straddled the "top 25%" tier and
 * Saka's 0.8198 as an RW — genuinely inside the top 15% — printed "TOP 25%".
 * Deriving the anchor from the band makes that class of bug unrepresentable:
 * there is one table now, not two.
 */
const BAND_SHARE: Partial<Record<PerfBand, number>> = {
    best: 15,
    elite: 5,
    supreme: 1,
};

/** "an AM" / "a CB". The string is CSS-uppercased at render. */
const POS_ARTICLE: Record<GranularPosition, string> = {
    GK: 'a', CB: 'a', LB: 'an', RB: 'an', LWB: 'an', RWB: 'an',
    DM: 'a', CM: 'a', AM: 'an', LW: 'an', RW: 'an', ST: 'an',
};

/**
 * The rank anchor for one band, or undefined when it says nothing.
 *
 * Fires only for the three top bands. Below them the band IS the rank
 * statement, and "bottom 40%" is unpleasant without being actionable.
 */
export function rankAnchor(
    band: PerfBand,
    position: GranularPosition,
): string | undefined {
    const share = BAND_SHARE[band];
    if (share === undefined) return undefined;
    return `Top ${share}% for ${POS_ARTICLE[position]} ${position}`;
}

/**
 * "an attacking midfielder" — the long form, for the block's centre-line note.
 * Lives beside POS_ARTICLE so the two surfaces that render the block
 * (player card, matchup breakdown) name a position identically.
 */
const ROLE_NAME: Record<string, string> = {
    GK: 'a goalkeeper', CB: 'a centre-back', LB: 'a left-back', RB: 'a right-back',
    LWB: 'a left wing-back', RWB: 'a right wing-back', DM: 'a defensive midfielder',
    CM: 'a central midfielder', AM: 'an attacking midfielder',
    LW: 'a left winger', RW: 'a right winger', ST: 'a striker',
};

export function roleArticle(pos: string | null | undefined): string {
    return ROLE_NAME[String(pos ?? '').toUpperCase()] ?? 'this position';
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
function evidenceFor(key: PerfGroupKey, s: RawStats, position: GranularPosition): string {
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
            /* THREE THINGS WERE WRONG HERE AND DUKE CAUGHT ALL OF THEM FROM ONE
               ROW: a centre-back showing "5 tackles, 10 clearances, 6
               recoveries" and a verdict of STEADY.

               1. `fpl_cbi` is FPL's `clearances_blocks_interceptions`, not
                  clearances. Calling it "clearances" hid the fact that blocks
                  ARE counted, and interceptions with them.
               2. It printed recoveries for a CB, which the engine drops
                  entirely (`defActionsRaw = tackles + cbi * 0.5` for CB only).
                  Citing a stat the score ignores is worse than citing nothing.
               3. It never mentioned the term that usually SETS the band — the
                  clean sheet, or goals conceded against expected. For that row,
                  actions came to 10 and conceding 2 against 1.33 xGC took 3.35
                  straight back off; the reader could see neither.

               So: name the actions the position is actually graded on, then the
               outcome that discounted them. */
            const tk = n(s.fpl_tackles), cbi = n(s.fpl_cbi), rec = n(s.fpl_recoveries);
            const acts: string[] = [];
            if (tk) acts.push(`${tk} ${tk === 1 ? 'tackle' : 'tackles'}`);
            // Slashes, not a comma list: "1 tackle, 8 clearances, blocks and
            // interceptions, clean sheet" reads as four stats, because the
            // compound item's own commas are indistinguishable from the ones
            // separating the items. FPL never splits CBI into its three parts —
            // `clearances_blocks_interceptions` is the only field it publishes,
            // and RawStats has no separate counts to fall back on — so binding
            // it into one token is the honest way to keep the line scannable.
            if (cbi) acts.push(`${cbi} ${cbi === 1 ? 'clearance/block/interception' : 'clearances/blocks/interceptions'}`);
            // A centre-back's recoveries do not enter his defensive score, so
            // they are not evidence for his band. Every other graded position
            // counts them at half weight.
            if (rec && position !== 'CB') acts.push(`${rec} ${rec === 1 ? 'recovery' : 'recoveries'}`);

            const bits: string[] = [];
            if (acts.length) bits.push(acts.join(', '));

            const gc = n(s.goals_conceded), xgc = n(s.expected_goals_conceded);
            if (s.clean_sheet) {
                bits.push('clean sheet');
            } else if (gc > 0 && xgc >= 0.05) {
                // Which side of expected he finished on is the whole outcome
                // term, and it cuts both ways.
                const verb = gc > xgc ? 'conceded against' : 'conceded, against';
                bits.push(`${gc} ${verb} ${xgc.toFixed(1)} expected`);
            } else if (gc > 0) {
                bits.push(`${gc} conceded`);
            }
            if (!bits.length) return 'Little defensive work.';
            // Sentence-case the first fragment, whichever one it turned out to be.
            const line = bits.join(', ');
            return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
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

/* ══════════════════════════════════════════════════════════════════════════
   SEASON SCOPE

   The same four groups over a whole season, as the MEAN of the player's
   per-match group scores. Per-90 in spirit: it grades the level he plays at,
   so a 12-game starter and a 34-game starter are comparable, and availability
   is already answered by the appearance count printed beside it.

   Averaging is also what rescues `attacking`. Per match it is near-binary —
   blanked or returned — which is the whole reason for the mute rule. The MEAN
   of that binary over twenty-odd matches is continuous, so at season scope
   attacking separates players properly and nothing needs muting.

   SEPARATE CUTS, and they are not optional. A season mean is far tighter than
   a single match: measured over 455 player-seasons with 5+ appearances,
   attacking's p15→p85 spans just 0.488→0.568. Feeding those into the per-match
   BAND_CUTS would grade almost every player in the league "poor".

   ANCHORS COME FREE. They did not under the old independent RANK_CUTS — one
   season yields 27 AM player-seasons, which cannot honestly claim a 1% tail.
   Now that `rankAnchor` is a function of the BAND, a season `elite` band is by
   construction the top 5% of player-seasons and simply says so.

   POOLED ACROSS POSITIONS, with no per-position override. BAND_CUTS_BY_POS
   works per match because every bucket has hundreds of appearances; per
   season the same split gives 27 AMs and 84 CBs, which is not a distribution.

   REFRESH WITH THE OTHER CUT TABLES. Keeper groups rest on 30 player-seasons
   and are the weakest rows here. */

const SEASON_BAND_CUTS: Record<PerfGroupKey, readonly number[]> = {
    attacking:      [0.4884, 0.5105, 0.5382, 0.5684, 0.6030, 0.6581],
    creating:       [0.3877, 0.4464, 0.5304, 0.5901, 0.6382, 0.6958],
    defending:      [0.4040, 0.4605, 0.5200, 0.5596, 0.5848, 0.6131],
    involvement:    [0.3704, 0.4380, 0.5099, 0.5600, 0.5925, 0.6461],
    shotStopping:   [0.3720, 0.4515, 0.4982, 0.5149, 0.5334, 0.5416],
    goalsPrevented: [0.4834, 0.5214, 0.5591, 0.5778, 0.6396, 0.6534],
};

/** Same seven bands as a match, cut against the season distribution. */
function seasonBand(score: number, group: PerfGroupKey): Exclude<PerfBand, 'feat' | 'feat2'> {
    const [a, b, c, d, e, f] = SEASON_BAND_CUTS[group];
    if (score < a) return 'poor';
    if (score < b) return 'low';
    if (score < c) return 'mid';
    if (score < d) return 'good';
    if (score < e) return 'best';
    if (score < f) return 'elite';
    return 'supreme';
}

/** Season totals, for the evidence line. Counting stats, not rates. */
export interface SeasonEvidence {
    appearances: number;
    goals: number;
    assists: number;
    cleanSheets: number;
    saves: number;
}

function seasonEvidenceFor(key: PerfGroupKey, s: SeasonEvidence): string {
    const apps = s.appearances === 1 ? '1 appearance' : `${s.appearances} appearances`;
    switch (key) {
        case 'attacking': {
            if (!s.goals && !s.assists) return `No goals or assists in ${apps}.`;
            const parts: string[] = [];
            if (s.goals) parts.push(s.goals === 1 ? '1 goal' : `${s.goals} goals`);
            if (s.assists) parts.push(s.assists === 1 ? '1 assist' : `${s.assists} assists`);
            return `${parts.join(' and ')} in ${apps}.`;
        }
        case 'creating':
            return s.assists
                ? `${s.assists === 1 ? '1 assist' : `${s.assists} assists`} in ${apps}.`
                : `No assists in ${apps}.`;
        case 'defending':
        case 'goalsPrevented':
            return s.cleanSheets
                ? `${s.cleanSheets} clean ${s.cleanSheets === 1 ? 'sheet' : 'sheets'} in ${apps}.`
                : `No clean sheets in ${apps}.`;
        case 'shotStopping':
            return s.saves
                ? `${s.saves} ${s.saves === 1 ? 'save' : 'saves'} in ${apps}.`
                : `No saves in ${apps}.`;
        default:
            return apps.charAt(0).toUpperCase() + apps.slice(1) + '.';
    }
}

/**
 * The block for a whole season.
 *
 * `perMatch` is one breakdown per APPEARANCE — DNPs must be filtered out by the
 * caller, or the mean is dragged toward whatever a zero stat line scores.
 * Returns [] below `minAppearances`, because a two-game mean is noise wearing a
 * verdict.
 */
export function buildSeasonPerformanceGroups(
    perMatch: RatingBreakdownItem[][],
    position: GranularPosition,
    evidence: SeasonEvidence,
    minAppearances = 3,
): PerfGroup[] {
    if (perMatch.length < minAppearances) return [];

    const weights = POSITION_WEIGHTS[position] ?? POSITION_WEIGHTS.CM;
    const order = GROUP_ORDER[position] ?? GROUP_ORDER.CM;

    const out: PerfGroup[] = [];
    for (const key of order) {
        const members = GROUP_COMPONENTS[key];
        const weight = members.reduce((sum, c) => sum + (weights[c] ?? 0), 0);
        if (weight <= 0) continue;
        // No mute rule at season scope: the mean of a near-binary component
        // varies properly across a season, which is exactly what it cannot do
        // in a single match.

        let total = 0;
        for (const breakdown of perMatch) {
            const scoreOf = new Map<RatingComponent, number>();
            for (const item of breakdown) scoreOf.set(item.key, item.score);
            total += members.reduce((acc, c) => acc + (scoreOf.get(c) ?? 0) * (weights[c] ?? 0), 0) / weight;
        }
        const score = total / perMatch.length;
        const band = seasonBand(score, key);

        out.push({
            key,
            label: GROUP_LABEL[key],
            band,
            width: BAND_WIDTH[band],
            verdict: VERDICTS[key][BAND_INDEX[band]],
            evidence: seasonEvidenceFor(key, evidence),
            // Free, now that the anchor is defined as the band rather than
            // measured separately: a season `elite` band IS the top 5% of
            // player-seasons, so it can say so.
            rank: rankAnchor(band, position),
        });
    }
    return out;
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
        let band: PerfBand = perfBand(score, key, position);

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
            evidence: evidenceFor(key, stats, position),
            rank: isFeat ? undefined : rankAnchor(band, position),
        });
    }
    return out;
}
