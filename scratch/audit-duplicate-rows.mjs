/** Read-only: are rosters pointing at orphaned duplicate player rows? */
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

const boot = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: { 'User-Agent': 'FantasyFutbol/1.0' },
}).then((r) => r.json());
const fplNames = new Set(boot.elements.map((e) => `${e.first_name} ${e.second_name}`.toLowerCase()));
const fplWeb = new Set(boot.elements.map((e) => e.web_name.toLowerCase()));

let all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('players')
    .select('id, fpl_id, name, web_name, pl_team, is_active, photo_url')
    .range(from, from + 999);
  if (error) throw error;
  all = all.concat(data);
  if (data.length < 1000) break;
}

const inactive = all.filter((p) => !p.is_active);
const activeByName = new Map(all.filter((p) => p.is_active).map((p) => [p.name.toLowerCase(), p]));

// inactive rows that duplicate a still-active row (same name)
const dupes = inactive.filter((p) => activeByName.has(p.name.toLowerCase()));
console.log('total rows:', all.length, '| active:', all.filter((p) => p.is_active).length, '| inactive:', inactive.length);
console.log('inactive rows that duplicate an ACTIVE row by name:', dupes.length);
dupes.slice(0, 30).forEach((p) =>
  console.log(`   dup "${p.name}" inactive-row fpl_id=${p.fpl_id} team=${p.pl_team} | active row fpl_id=${activeByName.get(p.name.toLowerCase()).fpl_id}`)
);

// inactive rows whose player IS still named in the live bootstrap (i.e. still in the PL)
const stillInPl = inactive.filter((p) => fplNames.has(p.name.toLowerCase()) || (p.web_name && fplWeb.has(p.web_name.toLowerCase())));
console.log('\ninactive rows for players still present in the live FPL bootstrap:', stillInPl.length);
stillInPl.slice(0, 40).forEach((p) => console.log(`   ${p.name} (${p.pl_team}) fpl_id=${p.fpl_id} dup-of-active=${activeByName.has(p.name.toLowerCase())}`));

// which of those are rostered / carry pending departure decisions
const { data: roster } = await admin.from('roster_entries').select('player_id, team_id');
const rosterIds = new Set((roster ?? []).map((r) => r.player_id));
console.log('\nof those, rostered somewhere:', stillInPl.filter((p) => rosterIds.has(p.id)).length);

const { data: dd } = await admin
  .from('departure_decisions')
  .select('league_id, player_id, status, players(name, pl_team, is_active)')
  .eq('status', 'pending');
const bogus = (dd ?? []).filter(
  (d) => d.players && (fplNames.has(d.players.name.toLowerCase()))
);
console.log('pending departure_decisions total:', dd?.length ?? 0, '| for players still in the live bootstrap:', bogus.length);
bogus.slice(0, 40).forEach((d) => console.log('   BOGUS?', d.players.name, '-', d.players.pl_team, 'league', d.league_id.slice(0, 8)));
