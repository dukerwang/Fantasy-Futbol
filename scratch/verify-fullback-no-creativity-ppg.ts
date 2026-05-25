import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS, FLEX_CONFIG } from '../src/lib/scoring/matchRating';
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

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', name);
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    // Option 1: Current flex pool ['defensive', 'match_impact', 'goal_involvement']
    let playedCount = 0;
    let sumPtsOption1 = 0;
    
    // Option 2: Restricted flex pool ['defensive', 'match_impact']
    let sumPtsOption2 = 0;

    for (const r of statsRows ?? []) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedCount++;

      // Option 1
      FLEX_CONFIG.LB.components = ['defensive', 'match_impact', 'goal_involvement'];
      FLEX_CONFIG.RB.components = ['defensive', 'match_impact', 'goal_involvement'];
      const res1 = calculateMatchRating(s, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      sumPtsOption1 += res1.fantasyPoints;

      // Option 2
      FLEX_CONFIG.LB.components = ['defensive', 'match_impact'];
      FLEX_CONFIG.RB.components = ['defensive', 'match_impact'];
      const res2 = calculateMatchRating(s, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      sumPtsOption2 += res2.fantasyPoints;
    }

    console.log(`\n${p.name} (${p.primary_position}) - ${playedCount} games played:`);
    console.log(`  Option 1 (Flex with Goal Inv):   PPG: ${(sumPtsOption1 / playedCount).toFixed(2)}`);
    console.log(`  Option 2 (Pure Def/Impact Flex): PPG: ${(sumPtsOption2 / playedCount).toFixed(2)}`);
  }
})();

