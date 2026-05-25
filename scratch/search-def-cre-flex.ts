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

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz', 'Diogo Dalot', 'Kieran Trippier'];
  const playersData: any[] = [];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', name);
    if (!found || found.length === 0) continue;
    const p = found[0];
    const { data: statsRows } = await sb.from('player_stats').select('gameweek, stats').eq('player_id', p.id).not('stats','is',null);
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

  const flex: RatingComponent[] = ['defensive', 'creativity'];
  const results: any[] = [];

  // Sum of weights must be exactly 0.75
  // match_impact: 0.20 to 0.35 in steps of 0.05
  // defensive: 0.10 to 0.25 in steps of 0.05
  // creativity: 0.10 to 0.25 in steps of 0.05
  // influence: 0.00 to 0.10 in steps of 0.05
  // goal_involvement: 0.05 to 0.15 in steps of 0.05
  for (let mi = 0.20; mi <= 0.35; mi += 0.05) {
    for (let def = 0.10; def <= 0.25; def += 0.05) {
      for (let cre = 0.10; cre <= 0.25; cre += 0.05) {
        for (let inf = 0.00; inf <= 0.10; inf += 0.05) {
          for (let gi = 0.05; gi <= 0.15; gi += 0.05) {
            const sum = Number((mi + def + cre + inf + gi).toFixed(2));
            if (sum !== 0.75) continue;

            const weights = {
              match_impact: Number(mi.toFixed(2)),
              influence: Number(inf.toFixed(2)),
              creativity: Number(cre.toFixed(2)),
              threat: 0.00,
              defensive: Number(def.toFixed(2)),
              goal_involvement: Number(gi.toFixed(2)),
              finishing: 0.00,
              save_score: 0.00
            };

            const rJames = simulatePPG(playersData[0].stats, flex, weights);
            const pPorro = simulatePPG(playersData[1].stats, flex, weights);
            const dMunoz = simulatePPG(playersData[2].stats, flex, weights);
            const dDalot = simulatePPG(playersData[3].stats, flex, weights);
            const kTrippier = simulatePPG(playersData[4].stats, flex, weights);

            results.push({
              weights,
              rJames,
              pPorro,
              dMunoz,
              dDalot,
              kTrippier,
              avgElite: (rJames + pPorro + dMunoz + kTrippier) / 4
            });
          }
        }
      }
    }
  }

  // Sort by average elite score to find configurations that produce the healthiest competitive scores
  results.sort((a, b) => b.avgElite - a.avgElite);

  console.log(`Tested ${results.length} weight combinations under ['defensive', 'creativity'] flex.`);
  console.log("\nTop 5 configurations for healthiest elite averages:");
  for (let i = 0; i < 5; i++) {
    const w = results[i];
    console.log(`\nRank ${i + 1} (Elite Avg PPG: ${w.avgElite.toFixed(2)}):`);
    console.log(`  Weights: Match ${w.weights.match_impact}, Def ${w.weights.defensive}, Crea ${w.weights.creativity}, Inf ${w.weights.influence}, GI ${w.weights.goal_involvement}`);
    console.log(`  PPGs: Porro: ${w.pPorro.toFixed(2)} | James: ${w.rJames.toFixed(2)} | Muñoz: ${w.dMunoz.toFixed(2)} | Trippier: ${w.kTrippier.toFixed(2)} | Dalot: ${w.dDalot.toFixed(2)}`);
  }
})();
