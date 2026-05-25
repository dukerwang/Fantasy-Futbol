import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS, FLEX_CONFIG, POSITION_WEIGHTS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^\"|\"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // Load database reference stats for season 2025-26
  const { data: refData } = await sb.from('rating_reference_stats').select('position_group, component, median, stddev').eq('season', '2025-26');
  const refStats: any = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  if (refData && refData.length > 0) {
    for (const row of refData) {
      const pos = row.position_group;
      const comp = row.component;
      if (refStats[pos] && refStats[pos][comp]) {
        refStats[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
      }
    }
  }

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz', 'Diogo Dalot', 'Kieran Trippier'];
  const playersData: any[] = [];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', name);
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    playersData.push({ player: p, stats: statsRows });
  }

  // We will run the simulation with our new philosophical fullback design:
  // Flex: ['defensive', 'creativity']
  // Base Weights: Match Impact 0.30, Defensive 0.15, Creativity 0.15, Influence 0.05, Goal Involvement 0.10
  
  const testFlex = ['defensive', 'creativity'];
  const testWeights = {
    match_impact: 0.30,
    influence: 0.05,
    creativity: 0.15,
    threat: 0.00,
    defensive: 0.15,
    goal_involvement: 0.10,
    finishing: 0.00,
    save_score: 0.00
  };

  console.log("=========================================================================");
  console.log("PROPOSED FB SCORING ENGINE CALIBRATION:");
  console.log("Flex components: [defensive, creativity] (Pure Defensive vs. Playmaking split)");
  console.log("Weights: Match 0.30, Def 0.15, Crea 0.15, Inf 0.05, GI 0.10");
  console.log("=========================================================================");

  const originalFlexLB = { ...FLEX_CONFIG.LB };
  const originalFlexRB = { ...FLEX_CONFIG.RB };
  const originalWeightsLB = { ...POSITION_WEIGHTS.LB };
  const originalWeightsRB = { ...POSITION_WEIGHTS.RB };

  try {
    FLEX_CONFIG.LB = { flex: 0.25, components: testFlex as any };
    FLEX_CONFIG.RB = { flex: 0.25, components: testFlex as any };
    POSITION_WEIGHTS.LB = testWeights;
    POSITION_WEIGHTS.RB = testWeights;

    for (const { player, stats } of playersData) {
      let playedCount = 0;
      let sumPts = 0;
      let flexDefCount = 0;
      let flexCreaCount = 0;

      for (const r of stats) {
        const s = r.stats as any;
        if (!s || s.minutes_played === 0) continue;
        playedCount++;

        const res = calculateMatchRating(s, player.primary_position as GranularPosition, refStats, player.primary_position as GranularPosition);
        sumPts += res.fantasyPoints;

        // Let's analyze which component won the flex in this game
        // Sigmoid normalize for LB/RB is evaluated against their reference stats
        const ref = refStats[player.primary_position];
        const dc = Math.max(0, s.fpl_def_contrib ?? 0);
        const recoveries = Math.max(0, s.fpl_recoveries ?? 0);
        
        let csBonus = 0;
        if (s.clean_sheet && s.minutes_played >= 60) {
          csBonus = 12;
        }
        
        const gc = s.goals_conceded ?? 0;
        const xgc = s.expected_goals_conceded ?? 0;
        const xgcOutperf = Math.max(0, xgc - gc) * 5;
        const gcPenalty = Math.max(0, gc - xgc) * 5;

        const defRaw = dc + recoveries * 0.5 + csBonus + xgcOutperf - gcPenalty;
        
        const zDef = (defRaw - ref.defensive.median) / ref.defensive.stddev;
        const scoreDef = 1 / (1 + Math.exp(-zDef));

        const zCrea = ((s.fpl_creativity ?? 0) - ref.creativity.median) / ref.creativity.stddev;
        const scoreCrea = 1 / (1 + Math.exp(-zCrea));

        if (scoreDef > scoreCrea) {
          flexDefCount++;
        } else {
          flexCreaCount++;
        }
      }

      console.log(`  ${player.name.padEnd(16)}: ${(sumPts / playedCount).toFixed(2)} PPG (${playedCount} games)`);
      console.log(`    -> Flex Breakdown: shutdown_def: ${flexDefCount} games | playmaker_crea: ${flexCreaCount} games`);
    }
  } finally {
    FLEX_CONFIG.LB = originalFlexLB;
    FLEX_CONFIG.RB = originalFlexRB;
    POSITION_WEIGHTS.LB = originalWeightsLB;
    POSITION_WEIGHTS.RB = originalWeightsRB;
  }
})();
