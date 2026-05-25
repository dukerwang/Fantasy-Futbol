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
    .select('id, name, primary_position')
    .ilike('name', '%Szoboszlai%');

  const p = players![0];

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points_v2')
    .eq('player_id', p.id);

  const playedAll = statsRows!.filter(r => (r.stats as any)?.minutes_played > 0);
  const starters = statsRows!.filter(r => (r.stats as any)?.minutes_played >= 45);

  const sumAll = playedAll.reduce((s, r) => s + Number(r.fantasy_points_v2 ?? 0), 0);
  const sumStarters = starters.reduce((s, r) => s + Number(r.fantasy_points_v2 ?? 0), 0);

  console.log(` Dominik Szoboszlai V2 PPG in DB:`);
  console.log(`  All played (GP: ${playedAll.length}): ${(sumAll / playedAll.length).toFixed(2)}`);
  console.log(`  Starters   (GP: ${starters.length}): ${(sumStarters / starters.length).toFixed(2)}`);
})();
