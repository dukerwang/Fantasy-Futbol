/** Read-only: per-league team/roster counts + departed-player exposure. */
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

const { data: leagues } = await admin.from('leagues').select('id, name, status, current_season');
const { data: teams, error: te } = await admin.from('teams').select('id, league_id');
if (te) console.log('teams error:', te.message);
const { data: roster, error: re } = await admin
  .from('roster_entries')
  .select('team_id, players(name, pl_team, is_active)');
if (re) console.log('roster error:', re.message);

const teamLeague = new Map((teams ?? []).map((t) => [t.id, t.league_id]));
const perLeague = {};
for (const r of roster ?? []) {
  const lg = teamLeague.get(r.team_id);
  if (!lg) continue;
  perLeague[lg] ??= { total: 0, departed: [] };
  perLeague[lg].total++;
  if (r.players && !r.players.is_active) perLeague[lg].departed.push(`${r.players.name} (${r.players.pl_team})`);
}

for (const l of leagues ?? []) {
  const t = (teams ?? []).filter((x) => x.league_id === l.id).length;
  const p = perLeague[l.id] ?? { total: 0, departed: [] };
  console.log(
    `${l.name} | ${l.status} ${l.current_season} | teams=${t} rostered=${p.total} departed-on-roster=${p.departed.length}`
  );
  if (p.departed.length) console.log('     ', p.departed.slice(0, 60).join(', '));
}

const { data: dd } = await admin
  .from('departure_decisions')
  .select('league_id, status, season_from')
  .limit(1000);
const ddCounts = {};
(dd ?? []).forEach((r) => {
  const k = `${r.league_id} ${r.season_from} ${r.status}`;
  ddCounts[k] = (ddCounts[k] ?? 0) + 1;
});
console.log('\ndeparture_decisions:', ddCounts);
