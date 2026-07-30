/** Read-only: who does the stats page's archived pool exclude? */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function all(table, select, eq) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select(select).range(from, from + 999);
    if (eq) q = q.eq(eq[0], eq[1]);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data);
    if (data.length < 1000) break;
  }
  return out;
}

const seasons = {};
for (const r of await all('season_player_stats_archive', 'season')) seasons[r.season] = (seasons[r.season] ?? 0) + 1;
console.log('season_player_stats_archive rows by season:', seasons);

const arch2526 = new Set((await all('season_player_stats_archive', 'player_id', ['season', '2025-26'])).map((r) => r.player_id));
const players = await all('players', 'id, name, pl_team, is_active, market_value');
const active = players.filter((p) => p.is_active);

const excluded = active.filter((p) => !arch2526.has(p.id));
console.log(`\nactive players: ${active.length}`);
console.log(`in the 2025-26 archive (what the stats page shows): ${active.filter((p) => arch2526.has(p.id)).length}`);
console.log(`ACTIVE BUT INVISIBLE on the stats page: ${excluded.length}`);

const byClub = {};
excluded.forEach((p) => (byClub[p.pl_team ?? 'NULL'] = (byClub[p.pl_team ?? 'NULL'] ?? 0) + 1));
console.log('\nexcluded, by club:');
Object.entries(byClub)
  .sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.log(`   ${c.padEnd(24)} ${n}`));

console.log('\ntop excluded by market value:');
excluded
  .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
  .slice(0, 25)
  .forEach((p) => console.log(`   £${p.market_value}m  ${p.name} (${p.pl_team})`));
