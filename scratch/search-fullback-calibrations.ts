import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import * as matchRatingModule from '../src/lib/scoring/matchRating';
import type { GranularPosition, RatingComponent } from '@/types';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
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

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];
  const playersData: any[] = [];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', name);
    if (!found || found.length === 0) {
      console.log(`Player ${name} not found!`);
      continue;
    }
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    playersData.push({ player: p, stats: statsRows });
  }

  function simulatePPG(
    statsRows: any[],
    flexComponents: RatingComponent[],
    positionWeights: Record<RatingComponent, number>
  ) {
    let gp = 0;
    let sumPts = 0;

    for (const r of statsRows) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      gp++;

      const originalFlex = matchRatingModule.FLEX_CONFIG.RB;
      const originalWeights = matchRatingModule.POSITION_WEIGHTS.RB;

      matchRatingModule.FLEX_CONFIG.RB = { flex: 0.25, components: flexComponents };
      matchRatingModule.POSITION_WEIGHTS.RB = positionWeights;

      try {
        const res = calculateMatchRating(s, 'RB', refStats, 'RB');
        sumPts += res.fantasyPoints;
      } finally {
        matchRatingModule.FLEX_CONFIG.RB = originalFlex;
        matchRatingModule.POSITION_WEIGHTS.RB = originalWeights;
      }
    }

    return gp > 0 ? sumPts / gp : 0;
  }

  console.log(`Loaded ${playersData.length} players. Running grid search...`);

  // Let's generate a fine-grained grid of weights
  // Sum of weights must be exactly 0.75
  const flexOptions: RatingComponent[][] = [
    ['creativity', 'match_impact', 'defensive'],
    ['match_impact', 'defensive'],
    ['defensive', 'match_impact', 'goal_involvement']
  ];

  const results: any[] = [];

  for (const flex of flexOptions) {
    // Grid search weights
    // match_impact: 0.15 to 0.40 in steps of 0.05
    // defensive: 0.15 to 0.40 in steps of 0.05
    // creativity: 0.00 to 0.20 in steps of 0.05
    // influence: 0.00 to 0.20 in steps of 0.05
    // goal_involvement: 0.05 (fixed)
    for (let mi = 0.15; mi <= 0.40; mi += 0.05) {
      for (let def = 0.15; def <= 0.40; def += 0.05) {
        for (let cre = 0.00; cre <= 0.20; cre += 0.05) {
          for (let inf = 0.00; inf <= 0.20; inf += 0.05) {
            // Check sum
            const sum = Number((mi + def + cre + inf + 0.05).toFixed(2));
            if (sum !== 0.75) continue;

            const weights = {
              match_impact: Number(mi.toFixed(2)),
              influence: Number(inf.toFixed(2)),
              creativity: Number(cre.toFixed(2)),
              threat: 0.00,
              defensive: Number(def.toFixed(2)),
              goal_involvement: 0.05,
              finishing: 0.00,
              save_score: 0.00
            };

            const rJames = simulatePPG(playersData[0].stats, flex, weights);
            const pPorro = simulatePPG(playersData[1].stats, flex, weights);
            const dMunoz = simulatePPG(playersData[2].stats, flex, weights);

            const isJamesWinner = rJames > pPorro && rJames > dMunoz;
            
            results.push({
              flex,
              weights,
              rJames,
              pPorro,
              dMunoz,
              isJamesWinner
            });
          }
        }
      }
    }
  }

  // Filter winners
  const winners = results.filter(r => r.isJamesWinner);
  console.log(`Total configurations tested: ${results.length}`);
  console.log(`Configurations where Reece James is #1: ${winners.length}`);

  // Sort winners by how close Reece James's PPG is to 11.59
  winners.sort((a, b) => Math.abs(a.rJames - 11.59) - Math.abs(b.rJames - 11.59));

  const targetsToPrint = ['Reece James', 'Pedro Porro', 'Daniel Muñoz', 'Diogo Dalot', 'Kieran Trippier'];
  const playersDataToPrint: any[] = [];

  for (const name of targetsToPrint) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', name);
    if (!found || found.length === 0) {
      console.log(`Player ${name} not found!`);
      continue;
    }
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    playersDataToPrint.push({ player: p, stats: statsRows });
  }

  const selectedFlex: RatingComponent[] = ['defensive', 'match_impact', 'goal_involvement'];
  const selectedWeights = {
    match_impact: 0.35,
    influence: 0.05,
    creativity: 0.15,
    threat: 0.00,
    defensive: 0.15,
    goal_involvement: 0.05,
    finishing: 0.00,
    save_score: 0.00
  };

  console.log("\n=========================================================================");
  console.log("PROPOSED FB SCORING ENGINE CALIBRATION EVALUATION (Rank 1):");
  console.log("Flex components: [defensive, match_impact, goal_involvement]");
  console.log("Weights: Match 0.35, Def 0.15, Crea 0.15, Inf 0.05, GI 0.05");
  console.log("=========================================================================");

  for (const { player, stats } of playersDataToPrint) {
    const ppg = simulatePPG(stats, selectedFlex, selectedWeights);
    console.log(`  ${player.name.padEnd(16)}: ${ppg.toFixed(2)} PPG (${stats.length} games)`);
  }
})();
