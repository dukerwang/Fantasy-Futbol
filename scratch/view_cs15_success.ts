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

  const validGkStats = allGkStats.filter(s => (s.stats.minutes_played ?? 0) >= 45);
  const playerMap = new Map(players.map(p => [p.id, p]));
  const playerStatsMap = new Map<string, any[]>();
  for (const s of validGkStats) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id)!.push(s.stats);
  }

  const csBonuses = [15];
  const saveFloors = [0.75, 0.80, 0.82, 0.85];
  const gcPenalties = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
  const defWeights = [0.25, 0.28, 0.30, 0.32, 0.34];

  const successes: any[] = [];

  for (const csBonus of csBonuses) {
    for (const saveFloorOnCS of saveFloors) {
      for (const gcPenalty of gcPenalties) {
        for (const defWeight of defWeights) {
          const saveWeight = 0.35 - defWeight;
          if (saveWeight < 0.01) continue;

          // 1. Medians/stddevs
          const rawDefValues: number[] = [];
          const rawSaveValues: number[] = [];
          for (const st of validGkStats.map(s => s.stats)) {
            const cleanSheet = st.clean_sheet === true;
            const recoveries = st.fpl_recoveries ?? 0;
            const cbi = st.fpl_cbi ?? 0;
            const gc = st.goals_conceded ?? 0;
            const csVal = (cleanSheet && (st.minutes_played ?? 0) >= 60) ? csBonus : 0;
            const defRaw = recoveries * 0.5 + cbi * 0.5 + csVal - gc * gcPenalty;
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

          // 2. Run simulation
          const getPlayerPPG = (playerId: string) => {
            const matchStats = playerStatsMap.get(playerId) || [];
            let totalPoints = 0;
            for (const st of matchStats) {
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
              
              const csVal = (cleanSheet && mins >= 60) ? csBonus : 0;
              const defRaw = recoveries * 0.5 + cbi * 0.5 + csVal - gc * gcPenalty;
              const defensiveScore = sigmoidNormalize(defRaw, defMedian, defStd);
              
              const sv = st.saves ?? 0;
              const psav = st.penalty_saves ?? 0;
              const saveRaw = sv * 2 + psav * 5;
              let saveScoreVal = sigmoidNormalize(saveRaw, saveMedian, saveStd);
              if (cleanSheet && mins >= 60) {
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
                if (scores[key as 'save_score' | 'defensive'] > maxScore) {
                  maxScore = scores[key as 'save_score' | 'defensive'];
                  maxComponent = key;
                }
              }
              
              const baseWeights = {
                match_impact: 0.25,
                influence: 0.20,
                defensive: defWeight,
                save_score: saveWeight
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
            }
            return totalPoints / matchStats.length;
          };

          const rayaPlayer = players.find(p => p.name.includes("Raya"))!;
          const roefsPlayer = players.find(p => p.name.includes("Roefs"))!;
          
          const rayaPpg = getPlayerPPG(rayaPlayer.id);
          const roefsPpg = getPlayerPPG(roefsPlayer.id);

          if (rayaPpg > roefsPpg) {
            successes.push({
              csBonus,
              saveFloorOnCS,
              gcPenalty,
              defWeight,
              saveWeight,
              rayaPpg,
              roefsPpg,
              diff: rayaPpg - roefsPpg
            });
          }
        }
      }
    }
  }

  console.log(`Found ${successes.length} csBonus = 15 configurations where Raya > Roefs.`);
  if (successes.length > 0) {
    successes.sort((a, b) => b.diff - a.diff);
    console.table(successes.slice(0, 10).map(s => ({
      csBonus: s.csBonus,
      saveFloor: s.saveFloorOnCS,
      gcPenalty: s.gcPenalty,
      defWeight: s.defWeight.toFixed(2),
      saveWeight: s.saveWeight.toFixed(2),
      RayaPPG: s.rayaPpg.toFixed(2),
      RoefsPPG: s.roefsPpg.toFixed(2),
      Diff: s.diff.toFixed(2)
    })));
  }
}

main().catch(console.error);
