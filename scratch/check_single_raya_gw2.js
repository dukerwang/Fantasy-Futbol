import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, mapFplLiveToRawStats } from '../src/lib/scoring/engine.ts';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';

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
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team, primary_position')
    .eq('name', 'David Raya');

  const raya = players[0];
  const { data: stats } = await supabase
    .from('player_stats')
    .select('gameweek, stats')
    .eq('player_id', raya.id)
    .eq('gameweek', 2);

  const rawStats = mapFplLiveToRawStats(stats[0].stats);
  const refStats = await loadReferenceStats(supabase, '2025-26');

  console.log("Raw stats in DB for Raya GW2:", stats[0].stats);
  console.log("Mapped raw stats:", rawStats);

  const ratingObj = calculateMatchRating(rawStats, 'GK', refStats);
  console.log("Calculated rating object with DB refStats:", JSON.stringify(ratingObj, null, 2));

  // Let's see what is inside compare_ranking.mjs's simulatePoints for Raya's GW2
  const GK_REF = {
    match_impact: { median: 12.00, stddev: 10.17 },
    influence: { median: 21.00, stddev: 12.42 },
    creativity: { median: 0.00, stddev: 2.08 },
    threat: { median: 0.00, stddev: 1.29 },
    defensive: { median: 5.50, stddev: 5.56 },
    goal_involvement: { median: 0.00, stddev: 0.33 },
    finishing: { median: 0.000, stddev: 0.04 },
    save_score: { median: 6.00, stddev: 4.55 }
  };

  function sigmoidNormalize(value, median, stddev) {
    if (stddev <= 0) return 0.5;
    const z = 1.0 * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
  }

  function simulatePoints(ms, params) {
    const {
      saveFloorOnCS = 0.80,
      csBonus = 20,
      baseWeights = { match_impact: 0.25, influence: 0.20, defensive: 0.25, save_score: 0.10 },
      flexWeight = 0.20,
    } = params;

    const rawBps = ms.bps ?? 0;
    const goalAssistBps = (ms.goals ?? 0) * 12 + (ms.assists ?? 0) * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);
    const matchImpactScore = sigmoidNormalize(adjustedBps, GK_REF.match_impact.median, GK_REF.match_impact.stddev);
    const inflScore = sigmoidNormalize(ms.influence ?? 0, GK_REF.influence.median, GK_REF.influence.stddev);

    const cleanSheet = ms.clean_sheet === true;
    const recoveries = ms.fpl_recoveries ?? 0;
    const cbi = ms.fpl_cbi ?? 0;
    const defActionsRaw = recoveries * 0.5 + cbi * 0.5;
    
    let actualCsBonus = 0;
    if (cleanSheet && (ms.minutes_played ?? 0) >= 60) {
      actualCsBonus = csBonus;
    }
    const defensiveRaw = defActionsRaw + actualCsBonus;
    const defensiveScore = sigmoidNormalize(defensiveRaw, GK_REF.defensive.median, GK_REF.defensive.stddev);

    const sv = ms.saves ?? 0;
    const psav = ms.penalty_saves ?? 0;
    const saveRaw = sv * 2 + psav * 5;
    let saveScoreVal = sigmoidNormalize(saveRaw, GK_REF.save_score.median, GK_REF.save_score.stddev);

    if (cleanSheet && (ms.minutes_played ?? 0) >= 60 && saveFloorOnCS > 0) {
      saveScoreVal = Math.max(saveScoreVal, saveFloorOnCS);
    }

    const scores = {
      match_impact: matchImpactScore,
      influence: inflScore,
      defensive: defensiveScore,
      save_score: saveScoreVal,
    };

    let maxScore = -1;
    let maxComponent = '';
    const flexComponents = ['save_score', 'defensive'];
    for (const key of flexComponents) {
      if (scores[key] > maxScore) {
        maxScore = scores[key];
        maxComponent = key;
      }
    }

    let composite = 0;
    for (const key of Object.keys(baseWeights)) {
      let finalWeight = baseWeights[key];
      if (key === maxComponent) {
        finalWeight += flexWeight;
      }
      composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);
    const displayRating = 3.0 + 7.0 * composite;
    const scoringRating = 1.0 + 9.0 * composite;
    const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
    let points = 10.0 * curve;
    if (scoringRating < 3.0) points -= 2.0;
    points = Math.max(0, points);

    return { scores, maxComponent, composite, displayRating, points };
  }

  console.log("\nSimulated calculations for Raya GW2:", simulatePoints(rawStats, {}));
}

main().catch(console.error);
