import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, RatingComponent, ReferenceStats, RatingBreakdownItem } from '@/types';

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Sigmoid Normalization helper
const SIGMOID_K = 1.0;
const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

// Model Weights Definitions
const MODEL_A_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_A_FLEX: RatingComponent[] = ['goal_involvement', 'finishing', 'threat'];

// Model B (Proposed 1 - Balanced)
const MODEL_B_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.20, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.15, save_score: 0.00
};
const MODEL_B_FLEX: RatingComponent[] = ['goal_involvement', 'finishing', 'threat', 'creativity'];

// Model C (Proposed 2 - Goalscorer Preserved)
const MODEL_C_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_C_FLEX: RatingComponent[] = ['goal_involvement', 'finishing', 'threat', 'creativity'];

// AM weights (reference from matchRating.ts)
const AM_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00
};
const AM_FLEX: RatingComponent[] = ['creativity', 'goal_involvement', 'finishing'];


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

// Calculate BPS and other component scores (identical to matchRating.ts)
function computeComponentScores(
    stats: RawStats,
    position: GranularPosition,
    ref: ReferenceStats
): Record<RatingComponent, number> {
    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const match_impact = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);
    const influence = sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);
    const creativity = sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);
    const threat = sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev);

    // Defensive actions
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);
    const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);

    const defActionsRaw = dc; // For LW/RW, defensive contribution is used
    const defensiveRaw = defActionsRaw + xgcOutperf - gcPenalty;
    const defensive = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);

    // Goal Involvement
    const goalInvRaw = stats.goals * 6 + stats.assists * 4;
    const goal_involvement = sigmoidNormalize(goalInvRaw, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV);

    // Finishing
    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const xgOutperf = stats.goals - xg;
    const xaOutperf = stats.assists - xa;
    const finInput = xgOutperf + (xaOutperf * 0.5);
    const finishing = sigmoidNormalize(finInput, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV);

    return {
        match_impact,
        influence,
        creativity,
        threat,
        defensive,
        goal_involvement,
        finishing,
        save_score: 0.5
    };
}

// Apply weights and flex
function applyWeights(
    scores: Record<RatingComponent, number>,
    weights: Record<RatingComponent, number>,
    flexComponents: RatingComponent[],
    flexAmount: number
): { composite: number; breakdown: { component: string; score: number; weight: number }[] } {
    let maxScore = -1;
    let maxComponent: RatingComponent | '' = '';

    for (const key of flexComponents) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    const breakdown = [];

    for (const key of Object.keys(weights) as RatingComponent[]) {
        const baseWeight = weights[key];
        let finalWeight = baseWeight;
        if (key === maxComponent) {
            finalWeight += flexAmount;
        }

        if (finalWeight === 0) continue;

        const score = scores[key];
        const weighted = score * finalWeight;
        composite += weighted;

        breakdown.push({
            component: COMPONENT_DISPLAY[key],
            score,
            weight: finalWeight
        });
    }

    return { composite: Math.min(1.0, composite), breakdown };
}

function computeScoringRating(composite: number): number {
    let r = 1.0 + 9.0 * composite;
    return Math.max(1.0, Math.min(10.0, r));
}

function curveFinalRating(composite: number): number {
    let rating = 3.0 + 7.0 * composite;
    return Math.max(1.0, Math.min(10.0, rating));
}

function calculateFantasyPoints(rating: number): number {
    const basePoints = 0.0;
    const scale = 10.0;
    const curve = Math.pow(Math.max(0, rating - 4.5) / 2.0, 1.5);
    let finalPoints = basePoints + (scale * curve);
    if (rating < 3.0) finalPoints -= 2.0;
    return Math.max(0, Number(finalPoints.toFixed(1)));
}

(async () => {
  console.log("=== COMPARING WINGER SCORING MODELS (A vs B vs C) ===");

  // Load ref stats
  const { data: refData } = await supabase
    .from('rating_reference_stats')
    .select('*')
    .eq('season', '2025/26');
  
  const refStats: any = {};
  if (refData && refData.length > 0) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact: { median: r.match_impact_median, stddev: r.match_impact_stddev },
        influence: { median: r.influence_median, stddev: r.influence_stddev },
        creativity: { median: r.creativity_median, stddev: r.creativity_stddev },
        threat: { median: r.threat_median, stddev: r.threat_stddev },
        defensive: { median: r.defensive_median, stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        finishing: { median: r.finishing_median, stddev: r.finishing_stddev },
        save_score: { median: r.save_score_median, stddev: r.save_score_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  const wingersToTest = [
    { name: "Jarrod Bowen", type: "Goalscoring Winger (RW)" },
    { name: "Harvey Barnes", type: "Goalscoring Winger (LW)" },
    { name: "Pedro Neto", type: "Creative Dribbler (RW)" },
    { name: "Marcus Tavernier", type: "Creative Winger (LW)" },
    { name: "Cody Gakpo", type: "Balanced Attacker (LW)" },
    { name: "Rayan Cherki", type: "Creative Dribbler (RW)" },
    { name: "Amad Diallo", type: "Creative Dribbler (RW)" },
    { name: "Antoine Semenyo", type: "Direct Goalscoring Winger (RW)" },
    { name: "Bukayo Saka", type: "Elite Winger (RW)" },
    { name: "Harry Wilson", type: "Creative Winger (RW)" },
    { name: "Bryan Mbeumo", type: "Goalscoring/Creative Winger (RW)" },
    { name: "Jérémy Doku", type: "Elite Dribbler (LW)" },
    { name: "Matheus Cunha", type: "Versatile Attacker (AM/LW)" },
    { name: "Morgan Rogers", type: "Attacking Midfielder (AM/LW)" }
  ];

  for (const item of wingersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`);

    if (!players || players.length === 0) {
      console.log(`Player "${item.name}" not found.`);
      continue;
    }

    const p = players[0];
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      console.log(`No stats rows found for ${p.name}`);
      continue;
    }

    const positionsToSim = p.primary_position === 'AM' 
      ? ['AM', 'LW'] 
      : [p.primary_position];

    for (const simPos of positionsToSim) {
      let gp = 0;
      
      // Model Accumulators
      let totalRatingA = 0; let totalPointsA = 0;
      let totalRatingB = 0; let totalPointsB = 0;
      let totalRatingC = 0; let totalPointsC = 0;

      const ref = refStats[simPos] || DEFAULT_REFERENCE_STATS[simPos as GranularPosition];

      // Select position weights and flex based on whether we are simulating winger or AM
      const isWinger = simPos === 'LW' || simPos === 'RW';
      const weightsA = isWinger ? MODEL_A_WEIGHTS : AM_WEIGHTS;
      const flexA = isWinger ? MODEL_A_FLEX : AM_FLEX;

      const weightsB = isWinger ? MODEL_B_WEIGHTS : AM_WEIGHTS; // Model B AM same
      const flexB = isWinger ? MODEL_B_FLEX : AM_FLEX;

      const weightsC = isWinger ? MODEL_C_WEIGHTS : AM_WEIGHTS; // Model C AM same
      const flexC = isWinger ? MODEL_C_FLEX : AM_FLEX;

      for (const r of statsRows) {
        const stats = r.stats as any;
        if (!stats || stats.minutes_played === 0) continue;
        gp++;

        const scores = computeComponentScores(stats, simPos as GranularPosition, ref);

        // Model A (Current)
        const resA = applyWeights(scores, weightsA, flexA, 0.25);
        const ratA = curveFinalRating(resA.composite);
        const scrA = computeScoringRating(resA.composite);
        const ptsA = calculateFantasyPoints(scrA);
        totalRatingA += ratA; totalPointsA += ptsA;

        // Model B (Balanced)
        const resB = applyWeights(scores, weightsB, flexB, 0.25);
        const ratB = curveFinalRating(resB.composite);
        const scrB = computeScoringRating(resB.composite);
        const ptsB = calculateFantasyPoints(scrB);
        totalRatingB += ratB; totalPointsB += ptsB;

        // Model C (Goalscorer Preserved)
        const resC = applyWeights(scores, weightsC, flexC, 0.25);
        const ratC = curveFinalRating(resC.composite);
        const scrC = computeScoringRating(resC.composite);
        const ptsC = calculateFantasyPoints(scrC);
        totalRatingC += ratC; totalPointsC += ptsC;
      }

      if (gp === 0) continue;

      const avgRatingA = totalRatingA / gp; const avgPPGA = totalPointsA / gp;
      const avgRatingB = totalRatingB / gp; const avgPPGB = totalPointsB / gp;
      const avgRatingC = totalRatingC / gp; const avgPPGC = totalPointsC / gp;

      console.log(`\n========================================================================`);
      console.log(`Player: ${p.name} (Simulated as ${simPos}) | Profile: ${item.type} | Games: ${gp}`);
      console.log(`------------------------------------------------------------------------`);
      console.log(`Model A (Current)   - Avg Rating: ${avgRatingA.toFixed(2)} | PPG: ${avgPPGA.toFixed(1)}`);
      console.log(`Model B (Balanced)  - Avg Rating: ${avgRatingB.toFixed(2)} | PPG: ${avgPPGB.toFixed(1)} | Delta: ${(avgPPGB - avgPPGA).toFixed(1)} (${avgPPGA > 0 ? (100 * (avgPPGB - avgPPGA) / avgPPGA).toFixed(1) : '0.0'}%)`);
      console.log(`Model C (Goalscorer)- Avg Rating: ${avgRatingC.toFixed(2)} | PPG: ${avgPPGC.toFixed(1)} | Delta: ${(avgPPGC - avgPPGA).toFixed(1)} (${avgPPGA > 0 ? (100 * (avgPPGC - avgPPGA) / avgPPGA).toFixed(1) : '0.0'}%)`);
    }
  }

  console.log(`\n========================================================================`);
})();
