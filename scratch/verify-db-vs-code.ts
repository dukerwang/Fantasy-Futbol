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

  const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%Pedro Porro%');
  if (!found || found.length === 0) {
    console.log('Reece James not found');
    return;
  }
  const p = found[0];

  const { data: statsRows } = await sb
    .from('player_stats')
    .select('gameweek, fantasy_points_v2, match_rating_v2, stats')
    .eq('player_id', p.id)
    .not('stats','is',null)
    .order('gameweek');

  console.log(`Reece James V2 DB vs Code Comparison:`);
  console.log(`GW   | Mins | DB Pts | Code Pts | DB Rating | Code Rating`);
  console.log(`-----|------|--------|----------|-----------|------------`);
  
  let dbSum = 0, codeSum = 0;
  let playedCount = 0;

  for (const r of statsRows ?? []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const res = calculateMatchRating(s, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
    
    dbSum += Number(r.fantasy_points_v2 ?? 0);
    codeSum += res.fantasyPoints;

    console.log(
      `GW${String(r.gameweek).padStart(2,'0')} | ` +
      `${String(s.minutes_played).padStart(4)} | ` +
      `${String(r.fantasy_points_v2).padStart(6)} | ` +
      `${String(res.fantasyPoints.toFixed(1)).padStart(8)} | ` +
      `${String(r.match_rating_v2).padStart(9)} | ` +
      `${String(res.rating.toFixed(1)).padStart(11)}`
    );
  }

  console.log(`\nPPG Played (DB): ${(dbSum / playedCount).toFixed(2)}`);
  console.log(`PPG Played (Code): ${(codeSum / playedCount).toFixed(2)}`);
})();
