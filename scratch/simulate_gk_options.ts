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

interface SimConfig {
  csBonus: number;
  saveFloorOnCS: number;
  defWeight: number;
  saveWeight: number;
  gcPenalty: number;
  xgcPenalty: boolean;
}

async function runSimulation(config: SimConfig, allGkStats: any[], players: any[]) {
  const playerMap = new Map(players.map(p => [p.id, p]));
  const gkResults: any[] = [];
  
  const rawDefValues: number[] = [];
  const rawSaveValues: number[] = [];
  
  for (const s of allGkStats) {
    const st = s.stats;
    const mins = st.minutes_played ?? 0;
    if (mins < 45) continue;
    
    const cleanSheet = st.clean_sheet === true;
    const recoveries = st.fpl_recoveries ?? 0;
    const cbi = st.fpl_cbi ?? 0;
    const gc = st.goals_conceded ?? 0;
    const xgc = st.expected_goals_conceded ?? 0;
    
    let csVal = 0;
    if (cleanSheet && mins >= 60) {
      csVal = config.csBonus;
    }
    
    let defRaw = recoveries * 0.5 + cbi * 0.5 + csVal;
    if (config.gcPenalty > 0) {
      defRaw -= gc * config.gcPenalty;
    }
    if (config.xgcPenalty) {
      const gcPenalty = Math.max(0, gc - xgc) * 5;
      const xgcOutperf = Math.max(0, xgc - gc) * 5;
      defRaw = defRaw + xgcOutperf - gcPenalty;
    }
    
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
    const squareDiffs = arr.map(value => {
      const diff = value - median;
      return diff * diff;
    });
    const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / arr.length;
    return Math.sqrt(avgSquareDiff);
  };
  
  const defMedian = getMedian(rawDefValues);
  const defStd = Math.max(0.1, getStddev(rawDefValues, defMedian));
  
  const saveMedian = getMedian(rawSaveValues);
  const saveStd = Math.max(0.1, getStddev(rawSaveValues, saveMedian));
  
  const playerStatsMap = new Map<string, any[]>();
  for (const s of allGkStats) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id)!.push(s);
  }
  
  const GK_REF = {
    match_impact: { median: 12.00, stddev: 10.17 },
    influence: { median: 21.00, stddev: 12.42 },
  };
  
  for (const [playerId, statsList] of playerStatsMap.entries()) {
    const p = playerMap.get(playerId);
    if (!p) continue;
    
    const validMatches = statsList.filter(s => (s.stats.minutes_played ?? 0) >= 45);
    if (validMatches.length < 5) continue;
    
    let totalPoints = 0;
    let totalRating = 0;
    let cleanSheets = 0;
    let totalSaves = 0;
    
    for (const s of validMatches) {
      const st = s.stats;
      const mins = st.minutes_played ?? 0;
      
      const rawBps = st.bps ?? 0;
      const goalAssistBps = (st.goals ?? 0) * 12 + (st.assists ?? 0) * 9;
      const adjustedBps = Math.max(0, rawBps - goalAssistBps);
      const matchImpactScore = sigmoidNormalize(adjustedBps, GK_REF.match_impact.median, GK_REF.match_impact.stddev);
      const inflScore = sigmoidNormalize(st.influence ?? 0, GK_REF.influence.median, GK_REF.influence.stddev);
      
      const cleanSheet = st.clean_sheet === true;
      const recoveries = st.fpl_recoveries ?? 0;
      const cbi = st.fpl_cbi ?? 0;
      const gc = st.goals_conceded ?? 0;
      const xgc = st.expected_goals_conceded ?? 0;
      
      let csVal = 0;
      if (cleanSheet && mins >= 60) {
        csVal = config.csBonus;
        cleanSheets++;
      }
      
      let defRaw = recoveries * 0.5 + cbi * 0.5 + csVal;
      if (config.gcPenalty > 0) {
        defRaw -= gc * config.gcPenalty;
      }
      if (config.xgcPenalty) {
        const gcPenalty = Math.max(0, gc - xgc) * 5;
        const xgcOutperf = Math.max(0, xgc - gc) * 5;
        defRaw = defRaw + xgcOutperf - gcPenalty;
      }
      
      const defensiveScore = sigmoidNormalize(defRaw, defMedian, defStd);
      
      const sv = st.saves ?? 0;
      totalSaves += sv;
      const psav = st.penalty_saves ?? 0;
      const saveRaw = sv * 2 + psav * 5;
      let saveScoreVal = sigmoidNormalize(saveRaw, saveMedian, saveStd);
      
      if (cleanSheet && mins >= 60 && config.saveFloorOnCS > 0) {
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
      const displayRating = 3.0 + 7.0 * composite;
      const scoringRating = 1.0 + 9.0 * composite;
      
      const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
      let points = 10.0 * curve;
      if (scoringRating < 3.0) points -= 2.0;
      points = Math.max(0, points);
      
      totalPoints += points;
      totalRating += displayRating;
    }
    
    const count = validMatches.length;
    gkResults.push({
      name: p.name,
      team: p.pl_team,
      ppg: totalPoints / count,
      avgRating: totalRating / count,
      cleanSheets,
      avgSaves: totalSaves / count,
      matches: count
    });
  }
  
  return gkResults.sort((a, b) => b.ppg - a.ppg);
}

async function main() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team, primary_position')
    .eq('primary_position', 'GK');

  if (!players) return;

  const playerIds = players.map(p => p.id);
  
  const allGkStats: any[] = [];
  const chunkSize = 10;
  for (let i = 0; i < playerIds.length; i += chunkSize) {
    const chunkIds = playerIds.slice(i, i + chunkSize);
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('player_id, gameweek, stats')
      .in('player_id', chunkIds);
    if (error) {
      console.error(error);
      continue;
    }
    if (stats) {
      allGkStats.push(...stats);
    }
  }

  const options = [
    {
      id: "Option 1",
      name: "Option 1: Strategy A.4 (Current Shadow - csBonus=20, saveFloor=0.80, gcPenalty=0, xgcPenalty=false)",
      config: { csBonus: 20, saveFloorOnCS: 0.80, defWeight: 0.25, saveWeight: 0.10, gcPenalty: 0, xgcPenalty: false }
    },
    {
      id: "Option 2",
      name: "Option 2: Moderate CS & GC Penalty (csBonus=15, saveFloor=0.75, gcPenalty=1.5, xgcPenalty=false)",
      config: { csBonus: 15, saveFloorOnCS: 0.75, defWeight: 0.25, saveWeight: 0.10, gcPenalty: 1.5, xgcPenalty: false }
    }
  ];

  for (const opt of options) {
    const results = await runSimulation(opt.config, allGkStats, players);
    
    console.log(`\n\n=== ${opt.id} Ranks ===`);
    console.log(opt.name);
    const tableData = results.slice(0, 10).map((r, idx) => ({
      Rank: idx + 1,
      Name: r.name,
      Team: r.team,
      PPG: Number(r.ppg.toFixed(2)),
      Rating: Number(r.avgRating.toFixed(2)),
      CS: r.cleanSheets,
      'Avg Saves': Number(r.avgSaves.toFixed(2)),
      Matches: r.matches
    }));
    console.table(tableData);
  }
}

main().catch(console.error);
