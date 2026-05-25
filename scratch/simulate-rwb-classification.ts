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

  const targets = [
    { name: 'Reece James', posOverride: 'RB' },
    { name: 'Pedro Porro', posOverride: 'RWB' },
    { name: 'Daniel Muñoz', posOverride: 'RWB' }
  ];

  console.log(`Simulating Fullback PPG if Pedro Porro & Daniel Muñoz are classified as RWB:`);
  console.log(`-------------------------------------------------------------------------`);

  for (const t of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').eq('name', t.name);
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    let playedCount = 0;
    let sumPts = 0;

    for (const r of statsRows ?? []) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedCount++;

      // Calculate score with position override
      const res = calculateMatchRating(s, t.posOverride as GranularPosition, refStats, t.posOverride as GranularPosition);
      sumPts += res.fantasyPoints;
    }

    console.log(`${p.name} (evaluated as ${t.posOverride}):`);
    console.log(`  PPG: ${(sumPts / playedCount).toFixed(2)} (${playedCount} games)`);
  }
})();
