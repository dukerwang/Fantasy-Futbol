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

  const playersToTest = [
    { name: "Elliot Anderson", pos: "DM" },
    { name: "James Garner", pos: "DM" },
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", pos: "DM" },
    { name: "Declan Rice", pos: "DM" }
  ];
  
  const ref = refStats.DM;

  console.log(`DM Reference Baselines for Normalization:`);
  console.log(`  - Match Impact: Median = ${ref.match_impact.median}, StdDev = ${ref.match_impact.stddev}`);
  console.log(`  - Influence: Median = ${ref.influence.median}, StdDev = ${ref.influence.stddev}`);
  console.log(`  - Creativity: Median = ${ref.creativity.median}, StdDev = ${ref.creativity.stddev}`);
  console.log(`  - Defensive: Median = ${ref.defensive.median}, StdDev = ${ref.defensive.stddev}`);
  console.log(`==========================================\n`);

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', `%${item.name}%`)
      .eq('primary_position', item.pos);
      
    if (!players || players.length === 0) {
      console.log(`❌ Player "${item.name}" not found!`);
      continue;
    }
    const p = players[0];
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);
      
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumRawBps = 0, sumRawInfl = 0, sumRawCreat = 0, sumRawDef = 0;
    let sumNormBps = 0, sumNormInfl = 0, sumNormCreat = 0, sumNormDef = 0;
    let sumPassesTotal = 0, sumPassesAccurate = 0, sumPassCompletionPct = 0;
    
    // Flex winners
    let flexWinners = { match_impact: 0, influence: 0, defensive: 0 };

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      gp++;
      
      const rawBps = stats.bps ?? 0;
      const goalAssistBps = stats.goals * 12 + stats.assists * 9;
      const adjustedBps = Math.max(0, rawBps - goalAssistBps);
      const rawInfl = stats.influence ?? 0;
      const rawCreat = stats.creativity ?? 0;
      
      // Clean sheet
      let csBonus = 0;
      if (stats.clean_sheet && stats.minutes_played >= 60) {
          csBonus = 12;
      }
      const xgc = stats.expected_goals_conceded ?? 0;
      const gc = stats.goals_conceded;
      const xgcOutperf = Math.max(0, xgc - gc) * 5;
      const gcPenalty = Math.max(0, gc - xgc) * 5;
      const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
      const defensiveRaw = dc + csBonus + xgcOutperf - gcPenalty;

      const normBps = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);
      const normInfl = sigmoidNormalize(rawInfl, ref.influence.median, ref.influence.stddev);
      const normCreat = sigmoidNormalize(rawCreat, ref.creativity.median, ref.creativity.stddev);
      const normDef = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);

      sumRawBps += adjustedBps;
      sumRawInfl += rawInfl;
      sumRawCreat += rawCreat;
      sumRawDef += defensiveRaw;

      sumNormBps += normBps;
      sumNormInfl += normInfl;
      sumNormCreat += normCreat;
      sumNormDef += normDef;

      sumPassesTotal += (stats.passes_total ?? 0);
      sumPassesAccurate += (stats.passes_accurate ?? 0);
      sumPassCompletionPct += (stats.pass_completion_pct ?? 0);
      
      // Find flex winner
      const flexScores = { match_impact: normBps, influence: normInfl, defensive: normDef };
      let maxKey: 'match_impact' | 'influence' | 'defensive' = 'match_impact';
      if (flexScores.influence > flexScores[maxKey]) maxKey = 'influence';
      if (flexScores.defensive > flexScores[maxKey]) maxKey = 'defensive';
      flexWinners[maxKey]++;
    }

    console.log(`Player: ${p.name} (Games: ${gp})`);
    console.log(`  Raw Averages:`);
    console.log(`    - Adj BPS   : ${(sumRawBps / gp).toFixed(2)}`);
    console.log(`    - Influence : ${(sumRawInfl / gp).toFixed(2)}`);
    console.log(`    - Creativity: ${(sumRawCreat / gp).toFixed(2)}`);
    console.log(`    - Defensive : ${(sumRawDef / gp).toFixed(2)}`);
    console.log(`    - Passes Att: ${(sumPassesTotal / gp).toFixed(1)}`);
    console.log(`    - Passes Acc: ${(sumPassesAccurate / gp).toFixed(1)}`);
    console.log(`    - Pass %    : ${(sumPassCompletionPct / gp).toFixed(1)}%`);
    console.log(`  Normalized Averages (0.0 to 1.0):`);
    console.log(`    - Match Impact Score: ${(sumNormBps / gp).toFixed(3)}`);
    console.log(`    - Influence Score   : ${(sumNormInfl / gp).toFixed(3)}`);
    console.log(`    - Creativity Score  : ${(sumNormCreat / gp).toFixed(3)}`);
    console.log(`    - Defensive Score   : ${(sumNormDef / gp).toFixed(3)}`);
    console.log(`  Flex Component Wins:`);
    console.log(`    - Match Impact: ${flexWinners.match_impact} (${(flexWinners.match_impact / gp * 100).toFixed(0)}%)`);
    console.log(`    - Influence   : ${flexWinners.influence} (${(flexWinners.influence / gp * 100).toFixed(0)}%)`);
    console.log(`    - Defensive   : ${flexWinners.defensive} (${(flexWinners.defensive / gp * 100).toFixed(0)}%)`);
    console.log(`------------------------------------------\n`);
  }
}

main();
