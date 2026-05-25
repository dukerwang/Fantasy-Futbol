import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS, applyPositionWeights, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

// Custom env loader
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        process.env[key] = value;
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position')
    .eq('name', 'Bruno Fernandes');

  if (!players || players.length === 0) {
    console.error("Could not find Bruno Fernandes");
    return;
  }
  const p = players[0];
  console.log(`Found Player: ${p.name} (Primary: ${p.primary_position})`);

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

  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null);

  if (!statsRows || statsRows.length === 0) {
    console.error("No stats found for Bruno Fernandes");
    return;
  }

  console.log(`Total Appearances: ${statsRows.length}`);

  let gp = 0;
  let ptsAM = 0;
  let ptsCM = 0;
  
  // Aggregate component scores to see why CM > AM
  const sumScoresAM: Record<string, number> = {};
  const sumScoresCM: Record<string, number> = {};
  const sumWeightsAM: Record<string, number> = {};
  const sumWeightsCM: Record<string, number> = {};
  const sumWeightedAM: Record<string, number> = {};
  const sumWeightedCM: Record<string, number> = {};

  for (const r of statsRows) {
    const mins = r.stats?.minutes_played ?? 0;
    if (mins === 0) continue;
    gp++;

    const ratingAM = calculateMatchRating(r.stats as any, 'AM', refStats, p.primary_position as GranularPosition);
    ptsAM += ratingAM.fantasyPoints;
    
    const ratingCM = calculateMatchRating(r.stats as any, 'CM', refStats, p.primary_position as GranularPosition);
    ptsCM += ratingCM.fantasyPoints;

    // Record breakdown details for explanation
    for (const b of ratingAM.breakdown) {
      sumScoresAM[b.component] = (sumScoresAM[b.component] ?? 0) + b.score;
      sumWeightsAM[b.component] = (sumWeightsAM[b.component] ?? 0) + b.weight;
      sumWeightedAM[b.component] = (sumWeightedAM[b.component] ?? 0) + b.weighted;
    }
    for (const b of ratingCM.breakdown) {
      sumScoresCM[b.component] = (sumScoresCM[b.component] ?? 0) + b.score;
      sumWeightsCM[b.component] = (sumWeightsCM[b.component] ?? 0) + b.weight;
      sumWeightedCM[b.component] = (sumWeightedCM[b.component] ?? 0) + b.weighted;
    }
  }

  console.log(`PPG as AM: ${(ptsAM / gp).toFixed(2)}`);
  console.log(`PPG as CM: ${(ptsCM / gp).toFixed(2)}`);

  console.log("\n=== AM COMPONENT BREAKDOWN (AVERAGES) ===");
  for (const comp of Object.keys(sumScoresAM)) {
    const avgScore = sumScoresAM[comp] / gp;
    const avgWeight = sumWeightsAM[comp] / gp;
    const avgWeighted = sumWeightedAM[comp] / gp;
    console.log(`${comp}: Avg Raw Normalized = ${avgScore.toFixed(3)}, Avg Weight = ${avgWeight.toFixed(2)}, Avg Contribution = ${avgWeighted.toFixed(3)}`);
  }

  console.log("\n=== CM COMPONENT BREAKDOWN (AVERAGES) ===");
  for (const comp of Object.keys(sumScoresCM)) {
    const avgScore = sumScoresCM[comp] / gp;
    const avgWeight = sumWeightsCM[comp] / gp;
    const avgWeighted = sumWeightedCM[comp] / gp;
    console.log(`${comp}: Avg Raw Normalized = ${avgScore.toFixed(3)}, Avg Weight = ${avgWeight.toFixed(2)}, Avg Contribution = ${avgWeighted.toFixed(3)}`);
  }

  // Let's also print some stats averages for Bruno
  let totalMinutes = 0, totalBps = 0, totalInfluence = 0, totalCreativity = 0, totalThreat = 0, totalDefContrib = 0, totalTackles = 0, totalCbi = 0, totalRecoveries = 0, totalCleanSheets = 0;
  for (const r of statsRows) {
    const s = r.stats;
    if (!s || s.minutes_played === 0) continue;
    totalMinutes += s.minutes_played;
    totalBps += s.bps ?? 0;
    totalInfluence += s.influence ?? 0;
    totalCreativity += s.creativity ?? 0;
    totalThreat += s.threat ?? 0;
    totalDefContrib += s.fpl_def_contrib ?? 0;
    totalTackles += s.fpl_tackles ?? 0;
    totalCbi += s.fpl_cbi ?? 0;
    totalRecoveries += s.fpl_recoveries ?? 0;
    if (s.clean_sheet && s.minutes_played >= 60) totalCleanSheets++;
  }

  console.log("\n=== BRUNO FERNANDES STATS AVERAGES (PER 90) ===");
  console.log(`Minutes: ${(totalMinutes / gp).toFixed(1)}`);
  console.log(`Bps: ${(totalBps / gp).toFixed(1)}`);
  console.log(`Influence: ${(totalInfluence / gp).toFixed(1)}`);
  console.log(`Creativity: ${(totalCreativity / gp).toFixed(1)}`);
  console.log(`Threat: ${(totalThreat / gp).toFixed(1)}`);
  console.log(`Def Contrib: ${(totalDefContrib / gp).toFixed(1)}`);
  console.log(`Tackles: ${(totalTackles / gp).toFixed(1)}`);
  console.log(`CBI: ${(totalCbi / gp).toFixed(1)}`);
  console.log(`Recoveries: ${(totalRecoveries / gp).toFixed(1)}`);
  console.log(`Clean Sheets: ${totalCleanSheets} / ${gp}`);
})();
