/**
 * Gaffa — Match Rating Engine
 *
 * Produces a 1-10 match rating from FPL live stats + API-Football metrics
 * using position-specific weight profiles.  The rating is then curved into
 * fantasy points.
 *
 * Pipeline
 * ────────
 *   Step 1  Normalize raw FPL metrics into 0.0–1.0 component scores (sigmoid)
 *   Step 2  Apply position-specific weights → weighted composite (0.0–1.0)
 *   Step 3  Linear map composite → 1.0–10.0 rating (with minutes cap)
 *   Step 4  Curve rating → fantasy points
 */

import type {
    GranularPosition,
    RawStats,
    MatchRating,
    RatingBreakdownItem,
    RatingComponent,
    PositionGroup,
    ReferenceStats,
} from '@/types';

// Define ComponentScores type as it's used in the new code
type ComponentScores = Record<RatingComponent, number>;

// ════════════════════════════════════════════════════════════════════════════
// Position Weight Profiles (all 12 granular positions)
// ════════════════════════════════════════════════════════════════════════════

export const FLEX_CONFIG: Record<GranularPosition, { flex: number; components: RatingComponent[] }> = {
    GK: { flex: 0.20, components: ['save_score', 'defensive'] },
    CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    LB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    RB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
    CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
    // Defensive and Match Impact are now included in LWB/RWB flex components
    // to ensure they get rewarded for clean sheets and solid defensive games just
    // like standard fullbacks, preventing quiet defensive games from dragging down
    // their scores while still allowing creative/attacking outputs to flex.
    LWB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity', 'threat', 'goal_involvement'] },
    RWB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity', 'threat', 'goal_involvement'] },
    AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
    LW: { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] },
    RW: { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] },
    ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};

//                                                                                                       Σ = 1.00
export const POSITION_WEIGHTS: Record<GranularPosition, Record<RatingComponent, number>> = {
    GK: { match_impact: 0.25, influence: 0.20, creativity: 0.00, threat: 0.00, defensive: 0.32, goal_involvement: 0.00, finishing: 0.00, save_score: 0.03 },
    CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 },
    LB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    RB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    LWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    RWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    AM: { match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    LW: { match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00 },
    RW: { match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00 },
    ST: { match_impact: 0.15, influence: 0.10, creativity: 0.10, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
};

// ════════════════════════════════════════════════════════════════════════════
// Position Group Mapping
// ════════════════════════════════════════════════════════════════════════════

export function getPositionGroup(pos: GranularPosition): PositionGroup {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') return 'DEF';
    if (pos === 'DM' || pos === 'CM' || pos === 'AM') return 'MID';
    return 'ATT'; // LW, RW, ST
}

// Helper to normalize position for FLEX_CONFIG and POSITION_WEIGHTS lookup
function normalizePosition(pos: GranularPosition): GranularPosition {
    // This function ensures that if a specific granular position isn't in the config,
    // a reasonable fallback is used. For now, it just returns the position itself,
    // assuming all granular positions are covered. If not, more complex logic
    // (e.g., mapping LB/RB to CB if no specific LB/RB config) would go here.
    return pos;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 1 — Sigmoid Normalization (raw metric → 0-1)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Steepness of the sigmoid curve.
 * K=1.0 is the neutral value — the sigmoid maps ±1σ to ~0.73/0.27.
 * Increasing K widens the spread but inflates consistently-elite players
 * (e.g. creative AMs) too aggressively; 1.0 keeps ratings honest.
 */
const SIGMOID_K = 1.0;

// ════════════════════════════════════════════════════════════════════════════
// Cross-position normalization for event components
//
// Goal involvement (goals × 6 + assists × 4) and finishing (xG outperformance)
// must be evaluated on a COMMON scale across all positions.  Position-specific
// gi_stddev values range from 1.67 (LWB) to 3.76 (ST): this alone means a
// LWB assist (giRaw=4) outscores a ST 2-goal game (giRaw=12) in V2, which is
// the wrong result for a cross-position fantasy ranking.
//
// Pooled outfield gi_stddev (average of per-position values) ≈ 2.28. We use a
// slightly wider 2.5 to avoid over-rewarding occasional goal-scorers.
//
// Pooled finishing_stddev ≈ 0.28 (V1 used 0.15 which over-rewarded clinical
// finishing; V2 per-position ST value of 0.47 is far too wide). 0.28 is a
// reasonable middle ground.
// ════════════════════════════════════════════════════════════════════════════

/** Common goal-involvement scale used for ALL outfield positions. */
const GLOBAL_GI_STDDEV = 2.5;
/** Median gi_raw across all outfield positions (almost all games have 0). */
const GLOBAL_GI_MEDIAN = 0;
/** Common finishing (xG outperf) scale used for ALL positions. */
const GLOBAL_FINISHING_STDDEV = 0.28;
/** Median xG outperformance across all outfield positions. */
const GLOBAL_FINISHING_MEDIAN = -0.03;

/**
 * Normalize a raw value to (0, 1) using the logistic sigmoid function.
 * A value at the median maps to 0.5; values beyond ±2 stddevs
 * compress toward 0 or 1.
 */
function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

// ════════════════════════════════════════════════════════════════════════════
// Component Display Names
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// Step 1 implementation — Compute 9 per-component scores
// ════════════════════════════════════════════════════════════════════════════

interface ComponentResult {
    score: number;  // 0.0 – 1.0
    detail: string; // human-readable
}

function computeComponentScores(
    stats: RawStats,
    position: GranularPosition,
    refStats: Record<GranularPosition, ReferenceStats>,
    primaryPosition?: GranularPosition,
): Record<RatingComponent, ComponentResult> {
    const ref = refStats[position]
        ?? (position === 'LWB' ? refStats.LB : undefined)
        ?? (position === 'RWB' ? refStats.RB : undefined)
        ?? refStats.CM
        ?? DEFAULT_REFERENCE_STATS[position]
        ?? DEFAULT_REFERENCE_STATS.CM;

    // 1. Match Impact (BPS)
    //    Subtract estimated goal/assist contribution to avoid double-counting
    //    with the Goal Involvement component.  BPS awards roughly +12 per goal
    //    and +9 per assist internally; we strip that out so Match Impact purely
    //    reflects non-goal contributions (tackles, passing, positioning, etc.).
    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const matchImpact: ComponentResult = {
        score: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        detail: `BPS: ${rawBps} (adj: ${adjustedBps})`,
    };

    // 2. Influence
    const infl = stats.influence ?? 0;
    const influence: ComponentResult = {
        score: sigmoidNormalize(infl, ref.influence.median, ref.influence.stddev),
        detail: `${infl.toFixed(1)}`,
    };

    // 3. Creativity
    const crea = stats.creativity ?? 0;
    const creativity: ComponentResult = {
        score: sigmoidNormalize(crea, ref.creativity.median, ref.creativity.stddev),
        detail: `${crea.toFixed(1)}`,
    };

    // 4. Threat
    const thr = stats.threat ?? 0;
    const threat: ComponentResult = {
        score: sigmoidNormalize(thr, ref.threat.median, ref.threat.stddev),
        detail: `${thr.toFixed(1)}`,
    };

    // 5. Defensive Score
    //    Primary signal: FPL `defensive_contribution` — a position-weighted
    //    defensive action count provided directly by the FPL API (25/26+).
    //      DEF: tackles + CBI
    //      MID/FWD: tackles + CBI + recoveries
    //      GK: 0 (use save_score instead)
    //
    //    Position-specific adjustments:
    //      - CB: clearance volume is nerfed (clearances are largely positional
    //        and lopsided in mid-block teams). We rebuild the raw input from
    //        components: tackles + CBI * 0.5, dropping FPL's flat DC for CBs.
    //      - Full-backs (LB/RB/LWB/RWB): FPL's DEF bucket excludes recoveries,
    //        but FBs do recover the ball routinely. Add recoveries * 0.5 on top.
    //      - DM/CM/AM/LW/RW/ST: FPL DC already includes recoveries; use directly.
    //
    //    Outcome modifiers (added on top of the activity signal):
    //      + xGC outperformance bonus (defense kept goals below the chance quality)
    //      − GC penalty (defense let goals through above the chance quality)
    //      + clean-sheet bonus (position-weighted: GK/DEF/DM full, CM half, AM/ATT 0)
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const posGroup = getPositionGroup(position);
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        let baseCs = 0;
        if (position === 'GK') {
            baseCs = 16; // Elevated Clean Sheet bonus for GK under Strategy A.4
        } else if (posGroup === 'DEF' || position === 'DM') {
            baseCs = 12; // Full bonus for DEF and DM
        } else if (position === 'CM') {
            baseCs = 4; // Reduced bonus for CM
        }
        
        // Option B: Capped CS strictly for AM playing at CB/LB/RB
        if (primaryPosition && primaryPosition === 'AM' && ['CB', 'LB', 'RB'].includes(position)) {
            csBonus = 0;
        } else {
            csBonus = baseCs;
        }
    }
    const canGetCS = csBonus > 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);
    const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);

    let defActionsRaw: number;
    if (position === 'GK') {
        defActionsRaw = recoveries * 0.5 + cbi * 0.5;
    } else if (position === 'CB') {
        defActionsRaw = tackles + cbi * 0.5;
    } else {
        // Symmetric 0.5x recoveries for all outfield positions to reward active
        // defending (tackles + cbi) and prevent low-block recovery farming.
        defActionsRaw = (tackles + cbi) + recoveries * 0.5;
    }

    let defensiveRaw: number;
    if (position === 'GK') {
        defensiveRaw = defActionsRaw + csBonus - gc * 4.0;
    } else {
        defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;
    }

    const defensive: ComponentResult = {
        score: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        detail: position === 'GK'
            ? (stats.clean_sheet && canGetCS)
                ? `CS, R ${recoveries}, CBI ${cbi}`
                : `R ${recoveries}, CBI ${cbi}`
            : (stats.clean_sheet && canGetCS)
                ? `CS, ${gc} conceded vs ${xgc.toFixed(1)} xGC (DC ${dc}, T ${tackles}, CBI ${cbi}, R ${recoveries})`
                : `${gc} conceded vs ${xgc.toFixed(1)} xGC (DC ${dc}, T ${tackles}, CBI ${cbi}, R ${recoveries})`,
    };



    // 7. Goal Involvement  (goals × 6 + assists × 4 — mirrors on-pitch impact)
    //    Uses a GLOBAL (cross-position) stddev so that 1 goal / 1 assist have the
    //    same fantasy value regardless of the scorer's position.  Position-specific
    //    normalization here creates the paradox where a LWB assist outscores a ST
    //    2-goal game because assists are rarer for LWBs.
    const g = stats.goals;
    const a = stats.assists;
    const goalInvRaw = g * 6 + a * 4;

    const goalParts: string[] = [];
    if (g > 0) goalParts.push(`${g} goal(s)`);
    if (a > 0) goalParts.push(`${a} assist(s)`);

    const goalInvolvement: ComponentResult = {
        score: sigmoidNormalize(goalInvRaw, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
        detail: goalParts.length > 0 ? goalParts.join(', ') : 'No goals or assists',
    };

    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const xgOutperf = g - xg;
    const xaOutperf = a - xa;
    const finInput = xgOutperf + (xaOutperf * 0.5);

    // Finishing also uses a global stddev: V2's per-position ST value (0.47) was
    // 3× wider than V1's (0.15), massively deflating clinical strikers like Haaland.
    const finishing: ComponentResult = {
        score: sigmoidNormalize(finInput, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
        detail: `${xgOutperf >= 0 ? '+' : ''}${xgOutperf.toFixed(2)} vs xG, ${xaOutperf >= 0 ? '+' : ''}${xaOutperf.toFixed(2)} vs xA`,
    };

    // 9. Save Score (GK-only — non-GKs get a neutral 0.5)
    let saveScore: ComponentResult;
    if (position === 'GK') {
        const sv = stats.saves;
        const psav = stats.penalty_saves;
        const saveRaw = sv * 2 + psav * 5;

        let scoreVal = sigmoidNormalize(saveRaw, ref.save_score.median, ref.save_score.stddev);
        if (stats.clean_sheet && stats.minutes_played >= 60) {
            scoreVal = Math.max(scoreVal, 0.85); // CS Save Floor under Strategy A.4
        }

        saveScore = {
            score: scoreVal,
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

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — Apply Position Weights → weighted composite (0-1)
// ════════════════════════════════════════════════════════════════════════════

export function applyPositionWeights(
    scores: ComponentScores,
    position: GranularPosition
): { composite: number; breakdown: RatingBreakdownItem[] } {
    const normalizedPos = normalizePosition(position);
    const weights = POSITION_WEIGHTS[normalizedPos] || POSITION_WEIGHTS.CM;
    const flexConfig = FLEX_CONFIG[normalizedPos] || FLEX_CONFIG.CM;

    let maxScore = -1;
    let maxComponent: RatingComponent | '' = '';

    for (const key of flexConfig.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    const breakdown: RatingBreakdownItem[] = [];

    for (const key of Object.keys(weights) as RatingComponent[]) {
        const weight = weights[key];

        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }

        if (finalWeight === 0) continue;

        const score = scores[key];
        const weighted = score * finalWeight;
        composite += weighted;

        // For breakdown, we need the original score and the final weight applied
        breakdown.push({
            component: COMPONENT_DISPLAY[key],
            key,
            score,
            weight: finalWeight, // Use finalWeight for breakdown
            weighted,
            detail: '', // Detail is not available here, would need to be passed from computeComponentScores
        });
    }

    return { composite: Math.min(1.0, composite), breakdown };
}

// ════════════════════════════════════════════════════════════════════════════
// Step 3 & 4 — Rating display + Fantasy Points
//
// Two separate scales exist:
//
//  • SCORING SCALE  (internal, unchanged)  1.0 + 9.0 × composite → [1, 10]
//    Used only as the input to calculateFantasyPoints so the points curve
//    calibration is never disturbed.
//
//  • DISPLAY SCALE  (curveFinalRating, exported)  3.0 + 7.0 × composite
//    Shifted so the median player (composite ≈ 0.50) lands near 6.5,
//    matching the Fotmob / SofaScore rating distribution that fans expect.
//    Top performers reach 8–9, poor games dip to 5.0–6.0.
//
// Fantasy points are intentionally decoupled from the display rating so
// that aesthetic re-calibration of the display never changes game balance.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Internal scoring-scale rating, used only to feed calculateFantasyPoints.
 * Never stored or shown in the UI — curveFinalRating() is the display value.
 */
function computeScoringRating(composite: number, minutesPlayed: number): number {
    if (composite < 0 || minutesPlayed === 0) return 0;
    let r = 1.0 + 9.0 * composite;
    return Math.max(1.0, Math.min(10.0, r));
}

/**
 * Display rating on the 1–10 scale shown to users.
 * 3.0 + 7.0 × composite maps the median composite (~0.50) to ≈ 6.5,
 * consistent with Fotmob/SofaScore where average PL starters rate 6.0–6.5.
 */
export function curveFinalRating(composite: number, minutesPlayed: number): number {
    if (composite < 0 || minutesPlayed === 0) return 0;

    // Compressed scale: keeps the 6.5 median starter floor, cools the elite averagers
    // down to 8.0, and elevates the absolute floor to 3.5 (matching Fotmob/SofaScore).
    let rating = 3.5 + 6.0 * composite;

    return Math.max(1.0, Math.min(10.0, rating));
}

/**
 * Fantasy points from the scoring-scale rating (not the display rating).
 * Calibration (SIGMOID_K=1.0, scale=7.0, exponent=1.5, base=2.0):
 * average game (6.5 display) ≈ 6.5 pts, good (7.0) ≈ 10 pts,
 * exceptional (8.0) ≈ 18 pts, masterclass (9.0) ≈ 27 pts.
 */
export function calculateFantasyPoints(rating: number, minutesPlayed: number): number {
    if (minutesPlayed === 0 || rating === 0) return 0;

    const basePoints = 0.0;
    const scale = 10.0;

    const curve = Math.pow(Math.max(0, rating - 4.5) / 2.0, 1.5);
    let finalPoints = basePoints + (scale * curve);

    if (rating < 3.0) finalPoints -= 2.0;

    return Math.max(0, Number(finalPoints.toFixed(2)));
}

// ════════════════════════════════════════════════════════════════════════════
// Default Reference Stats — offline fallback only
//
// Per-position medians/stddevs for each component's raw input. At runtime the
// `rating_reference_stats` table (filled by `scripts/recompute_reference_stats.mjs`
// from the current season's FPL `event/{gw}/live` + our `players.primary_position`)
// overrides these via `loadReferenceStats()`.
//
// Older idea was multi-season vaastav/merged_gw CSVs; that path does not carry
// 25/26 granular defense or `defensive_contribution`, so it cannot match this
// engine's defensive raw input. Multi-season baselines would need a bespoke merge.
// ════════════════════════════════════════════════════════════════════════════

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

// Per-position medians and stddevs for each rating-component raw input.
// These are FALLBACK values used only when the DB `rating_reference_stats`
// table is empty (e.g., a fresh deploy before the first sync). At runtime,
// `loadReferenceStats()` in src/lib/scoring/matchups.ts overlays the live DB
// values on top of these.
//
// Refresh: re-run `node scripts/recompute_reference_stats.mjs` whenever:
//   - A new season has accumulated >5 GWs of data
//   - The engine's raw-input formulas change (especially defensive)
//   - The 12-position taxonomy changes
//
// Values below were generated from 2025-26 FPL live data (GW1-35, minutes>=45).
//                 match_impact   influence      creativity     threat         defensive       goal_invol     finishing       save_score
export const DEFAULT_REFERENCE_STATS: Record<GranularPosition, ReferenceStats> = {
    GK:  makeRef([12.00, 10.17], [21.00, 12.42], [ 0.00,  2.08], [ 0.00,  1.29], [ 3.50, 10.72], [0.00, 0.33], [ 0.000, 0.04], [ 6.00,  4.55]),
    CB:  makeRef([10.00,  9.84], [20.00, 11.85], [ 1.40,  6.41], [ 2.00, 10.33], [ 8.80,  9.19], [0.00, 1.55], [-0.010, 0.22], [0.00, 1.00]),
    LB:  makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
    RB:  makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
    LWB: makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
    RWB: makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
    DM:  makeRef([14.00,  6.57], [13.40, 12.96], [10.50, 13.26], [ 2.00,  9.62], [18.30,  7.44], [0.00, 2.06], [-0.025, 0.28], [0.00, 1.00]),
    CM:  makeRef([13.00,  6.71], [12.00, 14.24], [15.00, 15.81], [ 6.00, 11.59], [14.50,  5.60], [0.00, 2.46], [-0.045, 0.32], [0.00, 1.00]),
    AM:  makeRef([12.00,  7.69], [11.20, 19.28], [17.10, 19.55], [12.00, 15.09], [11.50,  5.49], [0.00, 3.40], [-0.065, 0.45], [0.00, 1.00]),
    LW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
    RW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
    ST:  makeRef([ 6.00,  9.21], [ 6.80, 20.62], [ 6.10,  9.30], [19.00, 21.93], [ 9.00,  4.29], [0.00, 3.77], [-0.050, 0.47], [0.00, 1.00]),
};

// ════════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calculate a 1-10 match rating and curved fantasy points for a single
 * player's match stats.
 *
 * @param stats     Raw match stats (must include FPL live fields)
 * @param position  The granular position the player was deployed in
 * @param refStats  Per-position-group reference medians/stddevs
 */
export function calculateMatchRating(
    stats: RawStats,
    position: GranularPosition,
    refStats: Record<GranularPosition, ReferenceStats> = DEFAULT_REFERENCE_STATS,
    primaryPosition?: GranularPosition,
): MatchRating {
    // Player didn't play → zero rating
    if (stats.minutes_played === 0) {
        return { rating: 0, fantasyPoints: 0, position, breakdown: [] };
    }

    // Step 1: Normalize each component to 0-1 via sigmoid
    const components = computeComponentScores(stats, position, refStats, primaryPosition);

    const scores: ComponentScores = {} as ComponentScores;
    for (const [k, v] of Object.entries(components)) {
        scores[k as RatingComponent] = v.score;
    }

    // Step 2: Weighted composite
    const { composite, breakdown } = applyPositionWeights(scores, position);

    // Add detail to breakdown
    for (const item of breakdown) {
        item.detail = components[item.key as RatingComponent].detail;
    }

    // Step 3: Display rating (Fotmob-calibrated scale for UI)
    let rating = curveFinalRating(composite, stats.minutes_played);

    // Step 4: Fantasy points — uses internal scoring scale (1+9×composite),
    // completely decoupled from the display rating so points calibration is
    // never affected by display-scale adjustments.
    const scoringRating = computeScoringRating(composite, stats.minutes_played);
    let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);

    // Out-of-Position (OOP) penalty:
    // If a player's primary role is a midfielder or attacker (DM, CM, AM, LW, RW, ST)
    // and they are slotted into a defensive position (CB, LB, RB, LWB, RWB), apply a 20% penalty
    // to account for baseline-mismatch volume inflation.
    const isMidOrAtt = ['DM', 'CM', 'AM', 'LW', 'RW', 'ST'].includes(primaryPosition || '');
    const isDefSlot = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
    if (primaryPosition && isMidOrAtt && isDefSlot) {
        rating = rating * 0.80;
        fantasyPoints = fantasyPoints * 0.80;
    }

    return {
        rating: Math.round(rating * 100) / 100,
        fantasyPoints: Math.round(fantasyPoints * 100) / 100,
        position,
        breakdown,
    };
}
