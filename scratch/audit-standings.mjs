// Read-only audit: confirm stale-season stats are driving pre-season matchup resolution.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const gw of [1, 29, 38]) {
  const { data } = await admin
    .from('player_stats')
    .select('season')
    .eq('gameweek', gw)
    .limit(2000);
  const seasons = {};
  for (const r of data ?? []) seasons[r.season] = (seasons[r.season] ?? 0) + 1;
  console.log(`player_stats gameweek=${gw} →`, seasons);
}

// Which leagues have completed matchups despite not being in an active played season?
const { data: leagues } = await admin.from('leagues').select('id, name, status');
console.log('\nCompleted matchups by league status:');
for (const l of leagues ?? []) {
  const { count } = await admin
    .from('matchups')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', l.id)
    .in('status', ['live', 'completed']);
  if ((count ?? 0) > 0) console.log(`  [${l.status}] ${l.name} → ${count} counted matchups`);
}
