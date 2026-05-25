import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: players } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  const p = players![0];
  console.log(`Player: ${p.name} | Primary: ${p.primary_position} | Secondaries: ${JSON.stringify(p.secondary_positions)}`);

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, fantasy_points, fantasy_points_v2, stats')
    .eq('player_id', p.id);

  let playedCount = 0;
  let sumV1 = 0;
  let sumV2 = 0;

  for (const r of statsRows || []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;
    sumV1 += Number(r.fantasy_points ?? 0);
    sumV2 += Number(r.fantasy_points_v2 ?? 0);
  }

  console.log(`Played Games: ${playedCount}`);
  console.log(`Avg V1 PPG: ${(sumV1 / playedCount).toFixed(2)}`);
  console.log(`Avg V2 PPG: ${(sumV2 / playedCount).toFixed(2)}`);
})();
