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
  flexWeight: number;
  gcPenalty: number;
  includeSaveInFlex: boolean;
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

  // Grid search search parameters
  const csBonuses = [12, 14, 15, 16, 18, 20];
  const saveFloors = [0.65, 0.70, 0.75, 0.80, 0.85];
  const gcPenalties = [2.0, 2.5, 3.0, 3.5, 4.0];
  const defWeights = [0.25, 0.28, 0.30, 0.32, 0.34];
  const flexWeights = [0.05, 0.10, 0.15, 0.20];

  const candidates: { config: SimConfig; score: number; table: any[] }[] = [];

  console.log("Starting grid search...");

  for (const csBonus of csBonuses) {
    for (const saveFloorOnCS of saveFloors) {
      for (const gcPenalty of gcPenalties) {
        for (const defWeight of defWeights) {
          for (const flexWeight of flexWeights) {
            const saveWeight = 0.35 - defWeight; // Ensure base weights sum to same total
            if (saveWeight <= 0.01) continue;

            const includeSaveInFlex = true;

            // 1. Precalculate medians/stddevs for this specific gcPenalty
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
            const results: any[] = [];
            for (const [playerId, matchStats] of playerStatsMap.entries()) {
              const p = playerMap.get(playerId)!;
              let totalPoints = 0;
              let cleanSheets = 0;
              let totalSaves = 0;

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
                
                let csVal = 0;
                if (cleanSheet && mins >= 60) {
                  csVal = csBonus;
                  cleanSheets++;
                }
                
                const defRaw = recoveries * 0.5 + cbi * 0.5 + csVal - gc * gcPenalty;
                const defensiveScore = sigmoidNormalize(defRaw, defMedian, defStd);
                
                const sv = st.saves ?? 0;
                totalSaves += sv;
                const psav = st.penalty_saves ?? 0;
                const saveRaw = sv * 2 + psav * 5;
                let saveScoreVal = sigmoidNormalize(saveRaw, saveMedian, saveStd);
                
                if (cleanSheet && mins >= 60 && saveFloorOnCS > 0) {
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
                
                const scaleBase = (1.0 - flexWeight) / 0.80;
                
                const baseWeights = {
                  match_impact: 0.25 * scaleBase,
                  influence: 0.20 * scaleBase,
                  defensive: defWeight * scaleBase,
                  save_score: saveWeight * scaleBase
                };
                
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

              const count = matchStats.length;
              results.push({
                name: p.name,
                team: p.pl_team,
                ppg: totalPoints / count,
                cleanSheets,
                avgSaves: totalSaves / count,
                matches: count
              });
            }

            // Filter to regular starters (>= 15 matches)
            const starters = results.filter(r => r.matches >= 15).sort((a, b) => b.ppg - a.ppg);
            
            const raya = starters.find(r => r.name.includes("Raya"));
            const donnarumma = starters.find(r => r.name.includes("Donnarumma"));
            const roefs = starters.find(r => r.name.includes("Roefs"));
            const hermansen = starters.find(r => r.name.includes("Hermansen"));
            
            if (!raya || !roefs || !donnarumma || !hermansen) continue;

            let score = 0;
            
            // Hierarchy checks
            if (raya.ppg > roefs.ppg) score += 150;
            else score -= (roefs.ppg - raya.ppg) * 200;

            if (raya.ppg > donnarumma.ppg) score += 100;
            else score -= (donnarumma.ppg - raya.ppg) * 150;

            if (raya.ppg > hermansen.ppg) score += 150;
            else score -= (hermansen.ppg - raya.ppg) * 300;

            if (donnarumma.ppg > hermansen.ppg) score += 100;
            else score -= (hermansen.ppg - donnarumma.ppg) * 150;

            if (roefs.ppg > hermansen.ppg) score += 100;
            else score -= (hermansen.ppg - roefs.ppg) * 150;

            // Target PPG values
            // Raya target: 11.0 - 12.0
            if (raya.ppg >= 11.0 && raya.ppg <= 12.0) score += 100;
            else score -= Math.abs(raya.ppg - 11.5) * 50;

            // Hermansen target: 7.5 - 8.8
            if (hermansen.ppg >= 7.5 && hermansen.ppg <= 8.8) score += 150;
            else if (hermansen.ppg < 7.5) score -= (7.5 - hermansen.ppg) * 100;
            else score -= (hermansen.ppg - 8.8) * 150; // heavily penalize high Hermansen PPG!

            // Roefs target: 9.2 - 10.5
            if (roefs.ppg >= 9.2 && roefs.ppg <= 10.5) score += 100;
            else score -= Math.abs(roefs.ppg - 9.8) * 50;

            // Donnarumma target: 9.5 - 11.0
            if (donnarumma.ppg >= 9.5 && donnarumma.ppg <= 11.0) score += 100;
            else score -= Math.abs(donnarumma.ppg - 10.2) * 50;

            // Rank positions
            const startersSorted = [...starters];
            const rayaRank = startersSorted.findIndex(r => r.name.includes("Raya")) + 1;
            if (rayaRank === 1) score += 200;
            else score -= rayaRank * 50;

            candidates.push({
              config: { csBonus, saveFloorOnCS, defWeight, saveWeight, flexWeight, gcPenalty, includeSaveInFlex },
              score,
              table: starters.slice(0, 8)
            });
          }
        }
      }
    }
  }

  // Sort candidates by score
  candidates.sort((a, b) => b.score - a.score);

  console.log(`\n=== TOP 8 CALIBRATION CANDIDATES FOR FPL ALIGNMENT (WITH SAVES IN FLEX) ===`);
  for (let i = 0; i < Math.min(8, candidates.length); i++) {
    const c = candidates[i];
    console.log(`\nRank ${i+1} | Score: ${c.score.toFixed(1)}`);
    console.log(`Config: csBonus=${c.config.csBonus}, saveFloorOnCS=${c.config.saveFloorOnCS}, defWeight=${c.config.defWeight.toFixed(2)}, saveWeight=${c.config.saveWeight.toFixed(2)}, flexWeight=${c.config.flexWeight.toFixed(2)}, gcPenalty=${c.config.gcPenalty}, includeSaveInFlex=${c.config.includeSaveInFlex}`);
    console.table(c.table.map((r, idx) => ({
      Rank: idx + 1,
      Name: r.name,
      Team: r.team,
      PPG: r.ppg.toFixed(2),
      CS: r.cleanSheets,
      Matches: r.matches
    })));
  }
}

main().catch(console.error);
