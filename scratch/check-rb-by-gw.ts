import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const names = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];

  for (const name of names) {
    const { data: found } = await sb.from('players').select('id,name').ilike('name', `%${name}%`);
    if (!found?.length) continue;
    const p = found[0];

    const { data: rows } = await sb
      .from('player_stats')
      .select('gameweek, fantasy_points_v2, stats')
      .eq('player_id', p.id)
      .order('gameweek', { ascending: true });

    console.log(`\n${p.name}:`);
    console.log(`  GW  | Mins | V2 pts`);
    console.log(`  ----|------|-------`);
    for (const r of (rows ?? [])) {
      const mins = (r.stats as any)?.minutes_played ?? '?';
      const pts = r.fantasy_points_v2 ?? 'null';
      console.log(`  GW${String(r.gameweek).padStart(2,'0')} | ${String(mins).padStart(4,' ')} | ${pts}`);
    }
  }
})();
