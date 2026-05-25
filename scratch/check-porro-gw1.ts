import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

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

  const { data: found } = await sb.from('players').select('id,name').ilike('name', '%Pedro Porro%');
  const p = found![0];

  const { data: statsRows } = await sb
    .from('player_stats')
    .select('gameweek, stats, fantasy_points_v2')
    .eq('player_id', p.id)
    .eq('gameweek', 1);

  const row = statsRows![0];
  const s = row.stats as any;
  const res = calculateMatchRating(s, 'RB', refStats, 'RB');

  console.log(`Pedro Porro GW01 Stats & Scoring Breakdown:`);
  console.log(`Raw stats:`, s);
  console.log(`\nScoring Result:`, res);
  console.log(`Breakdown:`);
  for (const item of res.breakdown) {
    console.log(`  ${item.key.padEnd(20)}: score=${item.score.toFixed(3)}, weight=${item.weight.toFixed(3)}, weighted=${item.weighted.toFixed(3)} (${item.detail})`);
  }
})();
