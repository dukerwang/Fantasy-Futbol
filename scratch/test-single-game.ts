import { curveFinalRating, calculateFantasyPoints, DEFAULT_REFERENCE_STATS, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats } from '@/types';

const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;
const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

const DM_WEIGHTS = { match_impact: 0.30, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 };
const DM_FLEX = { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] };

function testGame(stats: RawStats, formulaType: string) {
    const ref = DEFAULT_REFERENCE_STATS.DM;

    // Clean sheet
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        csBonus = 12;
    }
    
    const xgc = stats.expected_goals_conceded ?? 0;
    const gc = stats.goals_conceded;
    
    let defensiveRaw = 0;
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    
    if (formulaType === "standard") {
        const xgcOutperf = Math.max(0, xgc - gc) * 5;
        const gcPenalty = Math.max(0, gc - xgc) * 5;
        defensiveRaw = dc + csBonus + xgcOutperf - gcPenalty;
    } else if (formulaType === "cleanslate") {
        defensiveRaw = dc + csBonus - (gc * 2.0);
    } else if (formulaType === "cleanslate_strict") {
        defensiveRaw = dc + csBonus - (gc * 3.0);
    }

    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const scores: any = {
        match_impact: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        influence: sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev),
        creativity: sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev),
        threat: sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev),
        defensive: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        goal_involvement: sigmoidNormalize(stats.goals * 6 + stats.assists * 4, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
        finishing: sigmoidNormalize((stats.goals - (stats.expected_goals ?? 0)) + ((stats.assists - (stats.expected_assists ?? 0)) * 0.5), GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
        save_score: 0.5,
    };

    let maxScore = -1;
    let maxComponent = '';
    for (const key of DM_FLEX.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(DM_WEIGHTS)) {
        const weight = (DM_WEIGHTS as any)[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += DM_FLEX.flex;
        }
        if (finalWeight === 0) continue;
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

    let rating = curveFinalRating(composite, stats.minutes_played);
    let scoringRating = 1.0 + 9.0 * composite;
    scoringRating = Math.max(1.0, Math.min(10.0, scoringRating));

    let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(fantasyPoints * 10) / 10,
        scores,
        maxComponent,
        composite
    };
}

const stats: RawStats = {
  minutes_played: 90,
  clean_sheet: false,
  goals_conceded: 3,
  expected_goals_conceded: 1.5,
  fpl_tackles: 7,
  fpl_recoveries: 5,
  fpl_def_contrib: 12,
  bps: 20,
  influence: 30,
  creativity: 10,
  threat: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  penalty_saves: 0,
  expected_goals: 0,
  expected_assists: 0
};

console.log("=== SIMULATING SINGLE GAME: LOSING 3-0 BUT MAKING 7 TACKLES ===");
const std = testGame(stats, "standard");
console.log(`Standard V2:`);
console.log(`  - Composite: ${std.composite.toFixed(3)} | Flex Winner: ${std.maxComponent}`);
console.log(`  - Scores   : Match Impact = ${std.scores.match_impact.toFixed(3)}, Influence = ${std.scores.influence.toFixed(3)}, Defensive = ${std.scores.defensive.toFixed(3)}`);
console.log(`  - Rating   : ${std.rating} | Points = ${std.fantasyPoints}`);

const clean = testGame(stats, "cleanslate");
console.log(`\nCleanSlate (2.0 flat penalty, no xGC outperf):`);
console.log(`  - Composite: ${clean.composite.toFixed(3)} | Flex Winner: ${clean.maxComponent}`);
console.log(`  - Scores   : Match Impact = ${clean.scores.match_impact.toFixed(3)}, Influence = ${clean.scores.influence.toFixed(3)}, Defensive = ${clean.scores.defensive.toFixed(3)}`);
console.log(`  - Rating   : ${clean.rating} | Points = ${clean.fantasyPoints}`);

const cleanStrict = testGame(stats, "cleanslate_strict");
console.log(`\nCleanStrict (3.0 flat penalty, no xGC outperf):`);
console.log(`  - Composite: ${cleanStrict.composite.toFixed(3)} | Flex Winner: ${cleanStrict.maxComponent}`);
console.log(`  - Scores   : Match Impact = ${cleanStrict.scores.match_impact.toFixed(3)}, Influence = ${cleanStrict.scores.influence.toFixed(3)}, Defensive = ${cleanStrict.scores.defensive.toFixed(3)}`);
console.log(`  - Rating   : ${cleanStrict.rating} | Points = ${cleanStrict.fantasyPoints}`);
