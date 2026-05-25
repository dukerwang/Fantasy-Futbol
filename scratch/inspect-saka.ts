import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, RatingComponent, ReferenceStats } from '@/types';

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

const MODEL_A_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_A_FLEX: RatingComponent[] = ['goal_involvement', 'finishing', 'threat'];

const MODEL_C_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_C_FLEX: RatingComponent[] = ['goal_involvement', 'finishing', 'threat', 'creativity'];

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

    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    const defensiveRaw = dc + xgcOutperf - gcPenalty;
    const defensive = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);

    const goalInvRaw = stats.goals * 6 + stats.assists * 4;
    const goal_involvement = sigmoidNormalize(goalInvRaw, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV);

    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const xgOutperf = stats.goals - xg;
    const xaOutperf = stats.assists - xa;
    const finInput = xgOutperf + (xaOutperf * 0.5);
    const finishing = sigmoidNormalize(finInput, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV);

    return {
        match_impact, influence, creativity, threat, defensive, goal_involvement, finishing, save_score: 0.5
    };
}

function applyWeights(
    scores: Record<RatingComponent, number>,
    weights: Record<RatingComponent, number>,
    flexComponents: RatingComponent[],
    flexAmount: number
): { composite: number; flexTriggered: RatingComponent | '' } {
    let maxScore = -1;
    let maxComponent: RatingComponent | '' = '';

    for (const key of flexComponents) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(weights) as RatingComponent[]) {
        let finalWeight = weights[key];
        if (key === maxComponent) {
            finalWeight += flexAmount;
        }
        composite += scores[key] * finalWeight;
    }

    return { composite: Math.min(1.0, composite), flexTriggered: maxComponent };
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
    const scale = 10.0;
    const curve = Math.pow(Math.max(0, rating - 4.5) / 2.0, 1.5);
    return Math.max(0, Number((scale * curve).toFixed(1)));
}

(async () => {
  const { data: refData } = await supabase.from('rating_reference_stats').select('*').eq('season', '2025/26');
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

  const { data: players } = await supabase.from('players').select('id, name, primary_position').ilike('name', '%Bukayo Saka%');
  if (!players || players.length === 0) {
    console.log("Saka not found");
    return;
  }
  const p = players[0];
  const { data: statsRows } = await supabase.from('player_stats').select('stats, gameweek').eq('player_id', p.id).not('stats', 'is', null);

  if (!statsRows || statsRows.length === 0) {
    console.log("No stats rows found");
    return;
  }

  console.log(`\n========================================================================`);
  console.log(`INSPECTING BUKAYO SAKA'S GAME-BY-GAME RATINGS`);
  console.log(`========================================================================\n`);

  let totalRatingA = 0; let totalPtsA = 0;
  let totalRatingC = 0; let totalPtsC = 0;
  let games = 0;

  const flexACounts: Record<string, number> = {};
  const flexCCounts: Record<string, number> = {};

  const ref = refStats.RW || DEFAULT_REFERENCE_STATS.RW;

  // We sort by gameweek
  const sortedRows = statsRows.sort((a, b) => {
    const gwA = a.gameweek ?? 0;
    const gwB = b.gameweek ?? 0;
    return gwA - gwB;
  });

  console.log(`GW | Mins | G | A | BPS | Creat | Threat | Model A Rat (Flex) | Model C Rat (Flex) | Pts A | Pts C | Delta`);
  console.log(`---|------|---|---|-----|-------|--------|---------------------|---------------------|-------|-------|------`);

  for (const row of sortedRows) {
    const stats = row.stats as any;
    if (!stats || stats.minutes_played === 0) continue;
    games++;

    const gw = row.gameweek ?? 0;

    const scores = computeComponentScores(stats, 'RW', ref);

    const resA = applyWeights(scores, MODEL_A_WEIGHTS, MODEL_A_FLEX, 0.25);
    const ratA = curveFinalRating(resA.composite);
    const scrA = computeScoringRating(resA.composite);
    const ptsA = calculateFantasyPoints(scrA);

    const resC = applyWeights(scores, MODEL_C_WEIGHTS, MODEL_C_FLEX, 0.25);
    const ratC = curveFinalRating(resC.composite);
    const scrC = computeScoringRating(resC.composite);
    const ptsC = calculateFantasyPoints(scrC);

    flexACounts[resA.flexTriggered] = (flexACounts[resA.flexTriggered] ?? 0) + 1;
    flexCCounts[resC.flexTriggered] = (flexCCounts[resC.flexTriggered] ?? 0) + 1;

    totalRatingA += ratA; totalPtsA += ptsA;
    totalRatingC += ratC; totalPtsC += ptsC;

    console.log(
      `${String(gw).padStart(2)} | ` +
      `${String(stats.minutes_played).padStart(4)} | ` +
      `${stats.goals} | ` +
      `${stats.assists} | ` +
      `${String(stats.bps).padStart(3)} | ` +
      `${String(Math.round(stats.creativity)).padStart(5)} | ` +
      `${String(Math.round(stats.threat)).padStart(6)} | ` +
      `${ratA.toFixed(2)} (${resA.flexTriggered.substring(0, 5)}) | ` +
      `${ratC.toFixed(2)} (${resC.flexTriggered.substring(0, 5)}) | ` +
      `${ptsA.toFixed(1).padStart(5)} | ` +
      `${ptsC.toFixed(1).padStart(5)} | ` +
      `${(ptsC - ptsA) >= 0 ? '+' : ''}${(ptsC - ptsA).toFixed(1)}`
    );
  }

  console.log(`\n========================================================================`);
  console.log(`SEASON SUMMARY:`);
  console.log(`========================================================================`);
  console.log(`Total Games: ${games}`);
  console.log(`Model A Avg Rating: ${(totalRatingA / games).toFixed(2)} | Avg PPG: ${(totalPtsA / games).toFixed(1)}`);
  console.log(`Model C Avg Rating: ${(totalRatingC / games).toFixed(2)} | Avg PPG: ${(totalPtsC / games).toFixed(1)}`);
  console.log(`\nFlex Triggers Count in Model A (Current):`);
  console.log(JSON.stringify(flexACounts, null, 2));
  console.log(`\nFlex Triggers Count in Model C (Proposed):`);
  console.log(JSON.stringify(flexCCounts, null, 2));

})();
