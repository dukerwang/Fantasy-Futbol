/**
 * Read-only: inspect specific newly-arrived players (Tzolis, Manzambi, etc.)
 * across FPL bootstrap, SoFIFA-derived fields, and the players table to find
 * where position/id sync is breaking.
 */
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

const names = ['tzolis', 'manzambi'];

const boot = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: { 'User-Agent': 'FantasyFutbol/1.0' },
}).then((r) => r.json());
const fplTeams = new Map(boot.teams.map((t) => [t.id, t.name]));

for (const n of names) {
  const el = boot.elements.find((e) => e.second_name.toLowerCase().includes(n) || e.web_name.toLowerCase().includes(n));
  console.log(`\n=== ${n} ===`);
  if (el) {
    console.log('FPL:', {
      id: el.id,
      first_name: el.first_name,
      second_name: el.second_name,
      web_name: el.web_name,
      team: fplTeams.get(el.team),
      element_type: el.element_type,
      status: el.status,
    });
  } else {
    console.log('NOT FOUND in FPL bootstrap');
  }
}

console.log('\n--- DB rows matching name ILIKE ---');
for (const n of names) {
  const { data, error } = await admin
    .from('players')
    .select('id, fpl_id, name, web_name, sofifa_common_name, full_name, primary_position, secondary_positions, pl_team, pl_team_id, is_active, updated_at')
    .or(`name.ilike.%${n}%,web_name.ilike.%${n}%,full_name.ilike.%${n}%,sofifa_common_name.ilike.%${n}%`);
  if (error) { console.log(n, 'ERROR', error.message); continue; }
  console.log(n, '->', JSON.stringify(data, null, 2));
}
