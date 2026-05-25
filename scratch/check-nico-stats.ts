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
    .select('id, name, primary_position, pl_team')
    .ilike('name', "%O'Reilly%");

  console.log("Players matching O'Reilly:", players);
  if (!players || players.length === 0) return;

  const p = players[0];
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2')
    .eq('player_id', p.id);

  console.log(`Stats rows for ${p.name}:`);
  for (const r of statsRows || []) {
    const s = r.stats as any;
    console.log(`GW ${r.gameweek} | Mins: ${s?.minutes_played} | Points V1: ${r.fantasy_points} | Points V2: ${r.fantasy_points_v2}`);
  }
})();
