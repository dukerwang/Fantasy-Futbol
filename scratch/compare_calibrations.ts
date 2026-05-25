import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

function sigmoidNormalize(value: number, median: number, stddev: number): number {
  if (stddev <= 0) return 0.5;
  const z = (value - median) / stddev;
  return 1 / (1 + Math.exp(-z));
}

const GK_REF = {
  match_impact: { median: 12.00, stddev: 10.17 },
  influence: { median: 21.00, stddev: 12.42 },
};

async function main() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team')
    .eq('name', 'David Raya');

  if (!players || players.length === 0) return;
  const rayaId = players[0].id;

  const { data: stats } = await supabase
    .from('player_stats')
    .select('player_id, gameweek, stats')
    .eq('player_id', rayaId);

  const { data: allGkStats } = await supabase
    .from('player_stats')
    .select('player_id, stats')
    .in('player_id', (await supabase.from('players').select('id').eq('primary_position', 'GK')).data!.map(p => p.id));

  const validGkStats = allGkStats!.filter(s => (s.stats.minutes_played ?? 0) >= 45);

  const config = { csBonus: 15, saveFloorOnCS: 0.75, defWeight: 0.25, saveWeight: 0.10, gcPenalty: 1.5 };

  // Calculate medians/stddevs
  const rawDefValues: number[] = [];
  const rawSaveValues: number[] = [];
  for (const st of validGkStats.map(s => s.stats)) {
    const cleanSheet = st.clean_sheet === true;
    const recoveries = st.fpl_recoveries ?? 0;
    const cbi = st.fpl_cbi ?? 0;
    const gc = st.goals_conceded ?? 0;
    const csVal = (cleanSheet && (st.minutes_played ?? 0) >= 60) ? config.csBonus : 0;
    const defRaw = recoveries * 0.5 + cbi * 0.5 + csVal - gc * config.gcPenalty;
    rawDefValues.push(defRaw);
    
    const sv = st.saves ?? 0;
    const psav = st.penalty_saves ?? 0;
    const saveRaw = sv * 2 + psav * 5;
    rawSaveValues.push(saveRaw);
  }

  const getMedian = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const getStddev = (arr: number[], median: number) => {
    const squareDiffs = arr.map(value => Math.pow(value - median, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / arr.length;
    return Math.sqrt(avgSquareDiff);
  };

  const defMedian = getMedian(rawDefValues);
  const defStd = Math.max(0.1, getStddev(rawDefValues, defMedian));
  const saveMedian = getMedian(rawSaveValues);
  const saveStd = Math.max(0.1, getStddev(rawSaveValues, saveMedian));

  console.log(`Medians: def=${defMedian.toFixed(2)}, defStd=${defStd.toFixed(2)}, save=${saveMedian.toFixed(2)}, saveStd=${saveStd.toFixed(2)}`);

  let totalPoints = 0;
  const validMatches = stats!.filter(s => (s.stats.minutes_played ?? 0) >= 45);
  for (const s of validMatches) {
    const st = s.stats;
    const rawBps = st.bps ?? 0;
    const goalAssistBps = (st.goals ?? 0) * 12 + (st.assists ?? 0) * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);
    const matchImpactScore = sigmoidNormalize(adjustedBps, GK_REF.match_impact.median, GK_REF.match_impact.stddev);
    const inflScore = sigmoidNormalize(st.influence ?? 0, GK_REF.influence.median, GK_REF.influence.stddev);
    
    const cleanSheet = st.clean_sheet === true;
    const recoveries = st.fpl_recoveries ?? 0;
    const cbi = st.fpl_cbi ?? 0;
    const gc = st.goals_conceded ?? 0;
    
    const csVal = (cleanSheet && (st.minutes_played ?? 0) >= 60) ? config.csBonus : 0;
    const defRaw = recoveries * 0.5 + cbi * 0.5 + csVal - gc * config.gcPenalty;
    const defensiveScore = sigmoidNormalize(defRaw, defMedian, defStd);
    
    const sv = st.saves ?? 0;
    const psav = st.penalty_saves ?? 0;
    const saveRaw = sv * 2 + psav * 5;
    let saveScoreVal = sigmoidNormalize(saveRaw, saveMedian, saveStd);
    if (cleanSheet && (st.minutes_played ?? 0) >= 60) {
      saveScoreVal = Math.max(saveScoreVal, config.saveFloorOnCS);
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
      if (scores[key as 'save_score' | 'defensive'] > maxScore) {
        maxScore = scores[key as 'save_score' | 'defensive'];
        maxComponent = key;
      }
    }
    
    const baseWeights = {
      match_impact: 0.25,
      influence: 0.20,
      defensive: config.defWeight,
      save_score: config.saveWeight
    };
    const flexWeight = 0.20;
    
    let composite = 0;
    for (const key of Object.keys(baseWeights)) {
      let finalWeight = baseWeights[key as keyof typeof baseWeights];
      if (key === maxComponent) {
        finalWeight += flexWeight;
      }
      composite += scores[key as keyof typeof scores] * finalWeight;
    }
    
    composite = Math.min(1.0, composite);
    const scoringRating = 1.0 + 9.0 * composite;
    const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
    let points = 10.0 * curve;
    if (scoringRating < 3.0) points -= 2.0;
    points = Math.max(0, points);
    
    totalPoints += points;
    console.log(`GW ${s.gameweek} | BPS=${st.bps} MI=${matchImpactScore.toFixed(3)} Infl=${inflScore.toFixed(3)} DefRaw=${defRaw.toFixed(1)} DefScore=${defensiveScore.toFixed(3)} MaxComp=${maxComponent} Comp=${composite.toFixed(3)} Pts=${points.toFixed(1)}`);
  }

  console.log(`David Raya Total PPG: ${(totalPoints / validMatches.length).toFixed(2)}`);
}

main().catch(console.error);
