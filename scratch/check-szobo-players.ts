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
    .select('id, name, primary_position, secondary_positions, total_points, ppg, form_rating, projected_points')
    .ilike('name', '%Szoboszlai%');

  console.log("Dominik Szoboszlai rows in 'players' table:");
  console.log(players);
})();
