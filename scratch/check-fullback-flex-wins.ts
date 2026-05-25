import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
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
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%' + name.replace('Muñoz', 'Mun') + '%');
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null)
      .order('gameweek');

    const wins: Record<string, number> = { creativity: 0, match_impact: 0, defensive: 0 };
    let playedCount = 0;

    for (const r of statsRows ?? []) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedCount++;

      const res = calculateMatchRating(s, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      
      // Re-run the flex logic manually to see which component won
      const components = ['creativity', 'match_impact', 'defensive'];
      let bestComp = 'creativity';
      let maxVal = -1;
      
      for (const c of components) {
        const item = res.breakdown.find(b => b.key === c);
        if (item) {
          // item.score is the 0-1 sigmoid score
          if (item.score > maxVal) {
            maxVal = item.score;
            bestComp = c;
          }
        }
      }
      wins[bestComp] = (wins[bestComp] ?? 0) + 1;
    }

    console.log(`\n========================================`);
    console.log(`${p.name} (${p.primary_position}) - Flex wins over ${playedCount} games played:`);
    for (const [k, v] of Object.entries(wins)) {
      console.log(`  ${k.padEnd(15)}: ${v} times (${((v/playedCount)*100).toFixed(1)}%)`);
    }
  }
})();
