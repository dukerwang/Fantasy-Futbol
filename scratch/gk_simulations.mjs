import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Default reference stats for GK from matchRating.ts
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

// Full simulation function for a single match stat under custom params
function simulatePoints(stats, params) {
  const {
    saveFloorOnCS = 0,
    csBonus = 12,
    baseWeights = { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
    flexWeight = 0.20,
  } = params;

  if ((stats.minutes_played ?? 0) === 0) return { rating: 0, points: 0 };

  // 1. Match Impact
  const rawBps = stats.bps ?? 0;
  const goalAssistBps = (stats.goals ?? 0) * 12 + (stats.assists ?? 0) * 9;
  const adjustedBps = Math.max(0, rawBps - goalAssistBps);
  const matchImpactScore = sigmoidNormalize(adjustedBps, GK_REF.match_impact.median, GK_REF.match_impact.stddev);

  // 2. Influence
  const inflScore = sigmoidNormalize(stats.influence ?? 0, GK_REF.influence.median, GK_REF.influence.stddev);

  // 3. Defensive
  const cleanSheet = stats.clean_sheet === true;
  const recoveries = stats.fpl_recoveries ?? 0;
  const cbi = stats.fpl_cbi ?? 0;
  const defActionsRaw = recoveries * 0.5 + cbi * 0.5;
  
  let actualCsBonus = 0;
  if (cleanSheet && (stats.minutes_played ?? 0) >= 60) {
    actualCsBonus = csBonus;
  }
  const defensiveRaw = defActionsRaw + actualCsBonus;
  const defensiveScore = sigmoidNormalize(defensiveRaw, GK_REF.defensive.median, GK_REF.defensive.stddev);

  // 4. Save Score
  const sv = stats.saves ?? 0;
  const psav = stats.penalty_saves ?? 0;
  const saveRaw = sv * 2 + psav * 5;
  let saveScoreVal = sigmoidNormalize(saveRaw, GK_REF.save_score.median, GK_REF.save_score.stddev);

  // Apply CS Save Floor
  if (cleanSheet && (stats.minutes_played ?? 0) >= 60 && saveFloorOnCS > 0) {
    saveScoreVal = Math.max(saveScoreVal, saveFloorOnCS);
  }

  // 5. Flex Assignment
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

  // Calculate composite
  let composite = 0;
  for (const key of Object.keys(baseWeights)) {
    let finalWeight = baseWeights[key];
    if (key === maxComponent) {
      finalWeight += flexWeight;
    }
    composite += scores[key] * finalWeight;
  }

  composite = Math.min(1.0, composite);

  // Linear display scale
  const displayRating = 3.0 + 7.0 * composite;

  // Scoring scale
  const scoringRating = 1.0 + 9.0 * composite;
  
  // Fantasy points curve
  const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
  let points = 10.0 * curve;
  if (scoringRating < 3.0) points -= 2.0;
  points = Math.max(0, points);

  return {
    rating: Math.round(displayRating * 10) / 10,
    points: Math.round(points * 10) / 10,
  };
}

async function main() {
  console.log('Fetching player stats from Supabase...');
  
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team')
    .eq('primary_position', 'GK');
    
  const playerIds = players.map(p => p.id);
  const { data: stats } = await supabase
    .from('player_stats')
    .select('player_id, gameweek, stats')
    .in('player_id', playerIds);

  const playerMap = new Map(players.map(p => [p.id, p]));
  const validPlayerStats = stats.filter(s => (s.stats.minutes_played ?? 0) >= 45);

  // Group by player
  const playerStatsMap = new Map();
  for (const s of validPlayerStats) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id).push(s.stats);
  }

  // We want to simulate these strategies:
  const strategies = [
    {
      name: 'Current Option 1 (Baseline)',
      params: {
        saveFloorOnCS: 0,
        csBonus: 12,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim A (CS Save Floor = 0.50)',
      params: {
        saveFloorOnCS: 0.50,
        csBonus: 12,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim A+ (CS Save Floor = 0.70)',
      params: {
        saveFloorOnCS: 0.70,
        csBonus: 12,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim AB (CS Floor = 0.50 + Weights: Def 0.25, Save 0.10)',
      params: {
        saveFloorOnCS: 0.50,
        csBonus: 12,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.25, save_score: 0.10 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim AB+ (CS Floor = 0.70 + Weights: Def 0.25, Save 0.10)',
      params: {
        saveFloorOnCS: 0.70,
        csBonus: 12,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.25, save_score: 0.10 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim C (CS Bonus = 18, Save Floor = 0)',
      params: {
        saveFloorOnCS: 0,
        csBonus: 18,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim AC+ (CS Floor = 0.70 + CS Bonus = 18)',
      params: {
        saveFloorOnCS: 0.70,
        csBonus: 18,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.20, save_score: 0.15 },
        flexWeight: 0.20
      }
    },
    {
      name: 'Sim ABC+ (CS Floor=0.70 + CS Bonus=18 + Weights: Def 0.25, Save 0.10)',
      params: {
        saveFloorOnCS: 0.70,
        csBonus: 18,
        baseWeights: { match_impact: 0.25, influence: 0.20, defensive: 0.25, save_score: 0.10 },
        flexWeight: 0.20
      }
    }
  ];

  console.log('\nStarting simulations...');

  for (const strat of strategies) {
    const results = [];
    for (const [playerId, matchStats] of playerStatsMap.entries()) {
      const p = playerMap.get(playerId);
      let totalPoints = 0;
      let totalRating = 0;
      for (const ms of matchStats) {
        const { rating, points } = simulatePoints(ms, strat.params);
        totalPoints += points;
        totalRating += rating;
      }
      const count = matchStats.length;
      results.push({
        name: p.name,
        team: p.pl_team,
        ppg: totalPoints / count,
        avgRating: totalRating / count,
        matches: count,
      });
    }

    results.sort((a, b) => b.ppg - a.ppg);

    console.log(`\n=== STRATEGY: ${strat.name} ===`);
    console.table(results.slice(0, 10).map((g, idx) => ({
      Rank: idx + 1,
      Name: g.name,
      Team: g.team,
      PPG: g.ppg.toFixed(2),
      Rating: g.avgRating.toFixed(2),
      Matches: g.matches
    })));
  }
}

main().catch(console.error);
