import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats } from '@/types';

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

async function main() {
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

  const playersToTest = ["Haaland", "João Pedro"];
  const ref = refStats.ST;

  console.log(`ST Reference Baselines for Normalization:`);
  console.log(`  - Influence: Median = ${ref.influence.median}, StdDev = ${ref.influence.stddev}`);
  console.log(`  - Creativity: Median = ${ref.creativity.median}, StdDev = ${ref.creativity.stddev}`);
  console.log(`==========================================\n`);

  for (const name of playersToTest) {
    const { data: players } = await supabase.from('players').select('id, name').ilike('name', `%${name}%`).eq('primary_position', 'ST');
    if (!players || players.length === 0) continue;
    const p = players[0];
    const { data: statsRows } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).not('stats', 'is', null);
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumRawInfluence = 0, sumRawCreativity = 0;
    let sumNormInfluence = 0, sumNormCreativity = 0;

    for (const r of statsRows) {
      if (r.stats?.minutes_played === 0) continue;
      gp++;
      const rawInfl = r.stats.influence ?? 0;
      const rawCreat = r.stats.creativity ?? 0;
      
      const normInfl = sigmoidNormalize(rawInfl, ref.influence.median, ref.influence.stddev);
      const normCreat = sigmoidNormalize(rawCreat, ref.creativity.median, ref.creativity.stddev);

      sumRawInfluence += rawInfl;
      sumRawCreativity += rawCreat;
      sumNormInfluence += normInfl;
      sumNormCreativity += normCreat;
    }

    const avgRawInfluence = sumRawInfluence / gp;
    const avgRawCreativity = sumRawCreativity / gp;
    const avgNormInfluence = sumNormInfluence / gp;
    const avgNormCreativity = sumNormCreativity / gp;

    console.log(`Player: ${p.name} (Games: ${gp})`);
    console.log(`  - Raw Avg: Influence = ${avgRawInfluence.toFixed(2)} | Creativity = ${avgRawCreativity.toFixed(2)}`);
    console.log(`  - Normalized Score (0.0 to 1.0):`);
    console.log(`    * Influence Score: ${avgNormInfluence.toFixed(3)}`);
    console.log(`    * Creativity Score: ${avgNormCreativity.toFixed(3)}`);
    console.log(`  - Base Weighted Score (Original: 10% Infl, 5% Creat):`);
    console.log(`    * ${(avgNormInfluence * 0.10 + avgNormCreativity * 0.05).toFixed(3)}`);
    console.log(`  - Base Weighted Score (Tweaked: 5% Infl, 10% Creat):`);
    console.log(`    * ${(avgNormInfluence * 0.05 + avgNormCreativity * 0.10).toFixed(3)}`);
    console.log(`  - Net Shift in Base Score: ${((avgNormInfluence * 0.05 + avgNormCreativity * 0.10) - (avgNormInfluence * 0.10 + avgNormCreativity * 0.05)).toFixed(3)}`);
    console.log(`------------------------------------------\n`);
  }
}

main();
