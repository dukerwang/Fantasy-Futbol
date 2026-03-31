"use strict";
/**
 * Fantasy Futbol — Match Rating Engine
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REFERENCE_STATS = exports.POSITION_WEIGHTS = exports.FLEX_CONFIG = void 0;
exports.getPositionGroup = getPositionGroup;
exports.applyPositionWeights = applyPositionWeights;
exports.curveFinalRating = curveFinalRating;
exports.calculateFantasyPoints = calculateFantasyPoints;
exports.calculateMatchRating = calculateMatchRating;
// ════════════════════════════════════════════════════════════════════════════
// Position Weight Profiles (all 12 granular positions)
// ════════════════════════════════════════════════════════════════════════════
exports.FLEX_CONFIG = {
    GK: { flex: 0.20, components: ['save_score', 'defensive'] },
    CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    LB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
    RB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
    DM: { flex: 0.25, components: ['match_impact', 'influence', 'goal_involvement'] },
    CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
    LM: { flex: 0.10, components: ['goal_involvement', 'creativity', 'influence'] },
    RM: { flex: 0.10, components: ['goal_involvement', 'creativity', 'influence'] },
    AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
    LW: { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat'] },
    RW: { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat'] },
    ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};
//                                                                                                       Σ = 1.00
exports.POSITION_WEIGHTS = {
    GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
    CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.20, finishing: 0.05, save_score: 0.00 },
    LB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    RB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    LM: { match_impact: 0.10, influence: 0.10, creativity: 0.10, threat: 0.10, defensive: 0.10, goal_involvement: 0.30, finishing: 0.10, save_score: 0.00 },
    RM: { match_impact: 0.10, influence: 0.10, creativity: 0.10, threat: 0.10, defensive: 0.10, goal_involvement: 0.30, finishing: 0.10, save_score: 0.00 },
    AM: { match_impact: 0.15, influence: 0.15, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
    LW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.05, defensive: 0.10, goal_involvement: 0.25, finishing: 0.25, save_score: 0.00 },
    RW: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.05, defensive: 0.10, goal_involvement: 0.25, finishing: 0.25, save_score: 0.00 },
    ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
};
// ════════════════════════════════════════════════════════════════════════════
// Position Group Mapping
// ════════════════════════════════════════════════════════════════════════════
function getPositionGroup(pos) {
    if (pos === 'GK')
        return 'GK';
    if (pos === 'CB' || pos === 'LB' || pos === 'RB')
        return 'DEF';
    if (pos === 'DM' || pos === 'CM' || pos === 'LM' || pos === 'RM' || pos === 'AM')
        return 'MID';
    return 'ATT'; // LW, RW, ST
}
// Helper to normalize position for FLEX_CONFIG and POSITION_WEIGHTS lookup
function normalizePosition(pos) {
    // This function ensures that if a specific granular position isn't in the config,
    // a reasonable fallback is used. For now, it just returns the position itself,
    // assuming all granular positions are covered. If not, more complex logic
    // (e.g., mapping LB/RB to CB if no specific LB/RB config) would go here.
    return pos;
}
// ════════════════════════════════════════════════════════════════════════════
// Step 1 — Sigmoid Normalization (raw metric → 0-1)
// ════════════════════════════════════════════════════════════════════════════
/** Steepness of the sigmoid curve. 1.5 gives good spread for football stats. */
var SIGMOID_K = 1.0;
/**
 * Normalize a raw value to (0, 1) using the logistic sigmoid function.
 * A value at the median maps to 0.5; values beyond ±2 stddevs
 * compress toward 0 or 1.
 */
function sigmoidNormalize(value, median, stddev) {
    if (stddev <= 0)
        return 0.5;
    var z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}
// ════════════════════════════════════════════════════════════════════════════
// Component Display Names
// ════════════════════════════════════════════════════════════════════════════
var COMPONENT_DISPLAY = {
    match_impact: 'Match Impact',
    influence: 'Influence',
    creativity: 'Creativity',
    threat: 'Threat',
    defensive: 'Defensive',
    goal_involvement: 'Goal Involvement',
    finishing: 'Finishing',
    save_score: 'Save Score',
};
function computeComponentScores(stats, position, refStats) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    var ref = refStats[position];
    // 1. Match Impact (BPS)
    //    Subtract estimated goal/assist contribution to avoid double-counting
    //    with the Goal Involvement component.  BPS awards roughly +12 per goal
    //    and +9 per assist internally; we strip that out so Match Impact purely
    //    reflects non-goal contributions (tackles, passing, positioning, etc.).
    var rawBps = (_a = stats.bps) !== null && _a !== void 0 ? _a : 0;
    var goalAssistBps = stats.goals * 12 + stats.assists * 9;
    var adjustedBps = Math.max(0, rawBps - goalAssistBps);
    var matchImpact = {
        score: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        detail: "BPS: ".concat(rawBps, " (adj: ").concat(adjustedBps, ")"),
    };
    // 2. Influence
    var infl = (_b = stats.influence) !== null && _b !== void 0 ? _b : 0;
    var influence = {
        score: sigmoidNormalize(infl, ref.influence.median, ref.influence.stddev),
        detail: "".concat(infl.toFixed(1)),
    };
    // 3. Creativity
    var crea = (_c = stats.creativity) !== null && _c !== void 0 ? _c : 0;
    var creativity = {
        score: sigmoidNormalize(crea, ref.creativity.median, ref.creativity.stddev),
        detail: "".concat(crea.toFixed(1)),
    };
    // 4. Threat
    var thr = (_d = stats.threat) !== null && _d !== void 0 ? _d : 0;
    var threat = {
        score: sigmoidNormalize(thr, ref.threat.median, ref.threat.stddev),
        detail: "".concat(thr.toFixed(1)),
    };
    // 5. Defensive Score
    //    Raw = clean_sheet bonus + xGC outperformance − goals-conceded penalty
    //    + FPL granular defensive actions
    //
    //    Nerfs to prevent volume-farming from dominating:
    //      - Tackle Diminishing Return: curve prevents 10-tackle games scaling linearly
    //      - CB CBI Nerf: clearance-spammers get half credit (stops Tarkowski exploiting volume)
    var gc = stats.goals_conceded;
    var xgc = (_e = stats.expected_goals_conceded) !== null && _e !== void 0 ? _e : 0;
    var posGroup = getPositionGroup(position);
    var csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (posGroup === 'GK' || posGroup === 'DEF' || position === 'DM') {
            csBonus = 12; // Full bonus for GK, DEF, and DM
        }
        else if (position === 'CM') {
            csBonus = 4; // Reduced bonus for CM
        }
        // LM, RM, AM, and ATT receive 0
    }
    var canGetCS = csBonus > 0;
    var xgcOutperf = Math.max(0, xgc - gc) * 5;
    var gcPenalty = Math.max(0, gc - xgc) * 5;
    var tackleCurve = Math.pow(Math.max(0, (_f = stats.fpl_tackles) !== null && _f !== void 0 ? _f : 0), 0.8) * 1.5;
    var recoveriesCurve = Math.pow(Math.max(0, (_g = stats.fpl_recoveries) !== null && _g !== void 0 ? _g : 0), 0.7) * 0.8;
    var cbiCurve = position === 'CB'
        ? Math.pow(Math.max(0, (_h = stats.fpl_cbi) !== null && _h !== void 0 ? _h : 0), 0.6) * 1.2
        : Math.pow(Math.max(0, (_j = stats.fpl_cbi) !== null && _j !== void 0 ? _j : 0), 0.8) * 1.2;
    var defActionsRaw = tackleCurve + cbiCurve + recoveriesCurve;
    var bypassPenalty = ((_k = stats.dribbled_past) !== null && _k !== void 0 ? _k : 0) * 2.0;
    var defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty - bypassPenalty;
    var defensive = {
        score: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        detail: (stats.clean_sheet && canGetCS)
            ? "CS, ".concat(gc, " conceded vs ").concat(xgc.toFixed(1), " xGC")
            : "".concat(gc, " conceded vs ").concat(xgc.toFixed(1), " xGC"),
    };
    // 7. Goal Involvement  (goals × 6 + assists × 4 — mirrors on-pitch impact)
    var g = stats.goals;
    var a = stats.assists;
    var goalInvRaw = g * 6 + a * 4;
    var goalParts = [];
    if (g > 0)
        goalParts.push("".concat(g, " goal(s)"));
    if (a > 0)
        goalParts.push("".concat(a, " assist(s)"));
    var goalInvolvement = {
        score: sigmoidNormalize(goalInvRaw, ref.goal_involvement.median, ref.goal_involvement.stddev),
        detail: goalParts.length > 0 ? goalParts.join(', ') : 'No goals or assists',
    };
    // 8. Finishing Quality  (outperformance of xG / xA)
    //    Uses a clamped linear function instead of sigmoid because per-match
    //    goals−xG is extremely sparse (most players have 0 goals, 0 xG).
    //    A sigmoid would snap to 1.0 for any player who scores, destroying nuance.
    var xg = (_l = stats.expected_goals) !== null && _l !== void 0 ? _l : 0;
    var xa = (_m = stats.expected_assists) !== null && _m !== void 0 ? _m : 0;
    var xgOutperf = g - xg;
    var xaOutperf = a - xa;
    var finishingScore = Math.max(0, Math.min(1, 0.5 + xgOutperf * 0.3 + xaOutperf * 0.15));
    var finishing = {
        score: finishingScore,
        detail: "".concat(xgOutperf >= 0 ? '+' : '').concat(xgOutperf.toFixed(2), " vs xG, ").concat(xaOutperf >= 0 ? '+' : '').concat(xaOutperf.toFixed(2), " vs xA"),
    };
    // 9. Save Score (GK-only — non-GKs get a neutral 0.5)
    var saveScore;
    if (position === 'GK') {
        var sv = stats.saves;
        var psav = stats.penalty_saves;
        var saveRaw = sv * 2 + psav * 5 - Math.max(0, gc - xgc) * 2;
        saveScore = {
            score: sigmoidNormalize(saveRaw, ref.save_score.median, ref.save_score.stddev),
            detail: "".concat(sv, " save(s)").concat(psav > 0 ? ", ".concat(psav, " pen save(s)") : ''),
        };
    }
    else {
        saveScore = { score: 0.5, detail: '—' };
    }
    return {
        match_impact: matchImpact,
        influence: influence,
        creativity: creativity,
        threat: threat,
        defensive: defensive,
        goal_involvement: goalInvolvement,
        finishing: finishing,
        save_score: saveScore,
    };
}
// ════════════════════════════════════════════════════════════════════════════
// Step 2 — Apply Position Weights → weighted composite (0-1)
// ════════════════════════════════════════════════════════════════════════════
function applyPositionWeights(scores, position) {
    var normalizedPos = normalizePosition(position);
    var weights = exports.POSITION_WEIGHTS[normalizedPos] || exports.POSITION_WEIGHTS.CM;
    var flexConfig = exports.FLEX_CONFIG[normalizedPos] || exports.FLEX_CONFIG.CM;
    var maxScore = -1;
    var maxComponent = '';
    for (var _i = 0, _a = flexConfig.components; _i < _a.length; _i++) {
        var key = _a[_i];
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }
    var composite = 0;
    var breakdown = [];
    for (var _b = 0, _c = Object.keys(weights); _b < _c.length; _b++) {
        var key = _c[_b];
        var weight = weights[key];
        var finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        if (finalWeight === 0)
            continue;
        var score = scores[key];
        var weighted = score * finalWeight;
        composite += weighted;
        // For breakdown, we need the original score and the final weight applied
        breakdown.push({
            component: COMPONENT_DISPLAY[key],
            key: key,
            score: score,
            weight: finalWeight, // Use finalWeight for breakdown
            weighted: weighted,
            detail: '', // Detail is not available here, would need to be passed from computeComponentScores
        });
    }
    return { composite: Math.min(1.0, composite), breakdown: breakdown };
}
// ════════════════════════════════════════════════════════════════════════════
// Step 3 & 4 — Curve Map → 1.0–10.0 Rating & Fantasy Points
// ════════════════════════════════════════════════════════════════════════════
function curveFinalRating(composite, minutesPlayed) {
    if (composite < 0 || minutesPlayed === 0)
        return 0;
    var rating = 1.0 + 9.0 * composite;
    // Flat minute penalty: if they barely played, they don't get a 10/10 no matter what
    if (minutesPlayed < 60) {
        var penalty = (1 - (minutesPlayed / 60)) * 1.5;
        rating = Math.max(1.0, rating - penalty);
    }
    return Math.max(1.0, Math.min(10.0, rating));
}
/**
 * Calculates fantasy points from a 1-10 match rating using an exponential curve.
 */
function calculateFantasyPoints(rating, minutesPlayed) {
    if (minutesPlayed === 0 || rating === 0)
        return 0;
    // Base 4.0 points for simply playing a decent match to pull down the midpoint
    var basePoints = 4.0;
    // Point expansion scale
    var scale = 5.0;
    // Sub-60 mins played penalty
    var minutePenalty = minutesPlayed < 60 ? 1.0 : 0;
    // 1.5 exponent gives a flat curve across standard games, heavily rewarding 8.5+ ratings
    var curve = Math.pow(Math.max(0, rating - 4.0) / 2.0, 1.5);
    var finalPoints = basePoints + (scale * curve) - minutePenalty;
    // If they got totally crushed (rating < 3.0), they can get 0 or negative
    if (rating < 3.0) {
        finalPoints -= 2.0;
    }
    return Math.max(0, Number(finalPoints.toFixed(1)));
}
// ════════════════════════════════════════════════════════════════════════════
// Default Reference Stats (seed values — will be replaced by historical CSV)
//
// Per-position-group medians and stddevs for each component's raw input.
// These are reasonable estimates; the real values should be computed from
// the vaastav/Fantasy-Premier-League merged_gw.csv data.
// ════════════════════════════════════════════════════════════════════════════
function makeRef(mi, inf, cre, thr, def, mc, gi, fin, sav) {
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
// Match Control baseline estimates: (influence × 1.5) + (bps × 1.0)
// Calibrated from FPL live data distributions per position.
//
exports.DEFAULT_REFERENCE_STATS = {
    // Generated by compute_fpl_reference_stats.js (>45m filter, Seasons: 23-24, 24-25, 25-26)
    GK: makeRef([14, 9.3], [21.8, 14.28], [0, 3.17], [0, 1.51], [0.2, 2.8], [0, 1], [0, 0.48], [0, 1], [6, 4.03]),
    CB: makeRef([12, 8.72], [18.2, 11.82], [1.8, 10.6], [2, 9.81], [0.2, 2.8], [0, 1], [0, 1.59], [0, 1], [0, 0.92]),
    LB: makeRef([10, 9.12], [14.8, 11.2], [10.3, 14.04], [4, 9.59], [0.2, 2.8], [0, 1], [0, 1.7], [-0.01, 1], [0, 1]),
    RB: makeRef([12, 9.3], [14.2, 11.53], [9.5, 12.92], [2, 8.06], [0.2, 2.8], [0, 1], [0, 1.82], [0, 1], [0, 1]),
    DM: makeRef([12, 6.54], [13, 12.62], [10.1, 13.09], [2, 10.22], [0.2, 2.8], [0, 1], [0, 1.95], [-0.01, 1], [0, 1.36]),
    CM: makeRef([11, 6.69], [12.2, 15.78], [14.2, 17.75], [8, 14.92], [0.2, 2.8], [0, 1], [0, 2.76], [-0.01, 0.11], [0, 1]),
    LM: makeRef([10, 7.07], [10.2, 17.61], [16.3, 16.71], [15, 17.83], [0.2, 2.8], [0, 1], [0, 3.17], [-0.02, 0.13], [0, 1]),
    RM: makeRef([9, 7.01], [11, 19.08], [15.1, 15.22], [16, 20.49], [0.2, 2.8], [0, 1], [0, 3.47], [-0.01, 0.13], [0, 1]),
    AM: makeRef([10, 7.47], [12, 19.4], [15.9, 17.88], [10, 16.43], [0.2, 2.8], [0, 1], [0, 3.46], [-0.01, 0.13], [0, 1.04]),
    LW: makeRef([10, 7.46], [10.6, 19.21], [15.95, 16.7], [19.5, 18.5], [0.2, 2.8], [0, 1], [0, 3.69], [-0.02, 0.15], [0, 1]),
    RW: makeRef([9, 7.45], [11.8, 19.08], [16.3, 17.59], [19, 18.11], [0.2, 2.8], [0, 1], [0, 3.48], [-0.01, 0.14], [0, 1]),
    ST: makeRef([6, 9.22], [8.2, 21.49], [10.8, 11.29], [21, 22.13], [0.2, 2.8], [0, 1], [0, 3.92], [-0.02, 0.15], [0, 1]),
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
 * @param curve     Fantasy-points curve configuration
 */
function calculateMatchRating(stats, position, refStats) {
    if (refStats === void 0) { refStats = exports.DEFAULT_REFERENCE_STATS; }
    // Player didn't play → zero rating
    if (stats.minutes_played === 0) {
        return { rating: 0, fantasyPoints: 0, position: position, breakdown: [] };
    }
    var posGroup = getPositionGroup(position);
    // Step 1: Normalize each component to 0-1 via sigmoid
    var components = computeComponentScores(stats, position, refStats);
    var scores = {};
    for (var _i = 0, _a = Object.entries(components); _i < _a.length; _i++) {
        var _b = _a[_i], k = _b[0], v = _b[1];
        scores[k] = v.score;
    }
    // Step 2: Weighted composite
    var _c = applyPositionWeights(scores, position), composite = _c.composite, breakdown = _c.breakdown;
    // Add detail to breakdown
    for (var _d = 0, breakdown_1 = breakdown; _d < breakdown_1.length; _d++) {
        var item = breakdown_1[_d];
        item.detail = components[item.key].detail;
    }
    // Step 3: Linear map → 1.0-10.0 (with minutes cap)
    var rating = curveFinalRating(composite, stats.minutes_played);
    // Step 4: Curve → fantasy points
    var fantasyPoints = calculateFantasyPoints(rating, stats.minutes_played);
    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(fantasyPoints * 10) / 10,
        position: position,
        breakdown: breakdown,
    };
}
