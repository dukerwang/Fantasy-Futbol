/**
 * Read-only audit: are the current-season PL clubs and their players present
 * and active in Gaffa? Compares the live FPL bootstrap against players rows.
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

const boot = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: { 'User-Agent': 'FantasyFutbol/1.0' },
}).then((r) => r.json());

const fplTeams = new Map(boot.teams.map((t) => [t.id, t.name]));
const fplElements = boot.elements.filter((e) => e.element_type >= 1 && e.element_type <= 4);
console.log('FPL current division (%d clubs):', fplTeams.size, [...fplTeams.values()].sort().join(', '));
console.log('FPL elements:', fplElements.length);

// pull all players in pages
let all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('players')
    .select('id, fpl_id, name, web_name, pl_team, pl_team_id, is_active, market_value, updated_at')
    .range(from, from + 999);
  if (error) throw error;
  all = all.concat(data);
  if (data.length < 1000) break;
}
console.log('DB players rows total:', all.length, '| active:', all.filter((p) => p.is_active).length);

const byClub = new Map();
for (const p of all) {
  const k = p.pl_team ?? 'NULL';
  if (!byClub.has(k)) byClub.set(k, { active: 0, inactive: 0 });
  byClub.get(k)[p.is_active ? 'active' : 'inactive']++;
}
console.log('\n--- DB players by pl_team ---');
[...byClub.entries()]
  .sort((a, b) => b[1].active - a[1].active)
  .forEach(([club, c]) => {
    const inFpl = [...fplTeams.values()].includes(club);
    console.log(
      `${inFpl ? 'PL ' : '   '} ${club.padEnd(26)} active=${String(c.active).padStart(3)} inactive=${String(c.inactive).padStart(3)}`
    );
  });

// Every current FPL element: do we have a row, and is it active?
const dbByFplId = new Map(all.filter((p) => p.fpl_id != null).map((p) => [p.fpl_id, p]));
const missing = [];
const inactiveButInPl = [];
for (const el of fplElements) {
  const row = dbByFplId.get(el.id);
  if (!row) missing.push(`${el.first_name} ${el.second_name} (${fplTeams.get(el.team)}) fpl_id=${el.id}`);
  else if (!row.is_active) inactiveButInPl.push(`${row.name} (${fplTeams.get(el.team)}) status=${el.status}`);
}
console.log('\ncurrent FPL players with NO db row:', missing.length);
missing.slice(0, 40).forEach((m) => console.log('  MISSING', m));
console.log('current FPL players whose db row is is_active=false:', inactiveButInPl.length);
inactiveButInPl.slice(0, 40).forEach((m) => console.log('  INACTIVE', m));

// last write times
const stamps = all.map((p) => p.updated_at).filter(Boolean).sort();
console.log('\noldest updated_at:', stamps[0], '| newest:', stamps[stamps.length - 1]);

// player_season_clubs coverage per season
const { data: pscSeasons } = await admin.from('player_season_clubs').select('season').limit(20000);
if (pscSeasons) {
  const counts = {};
  pscSeasons.forEach((r) => (counts[r.season] = (counts[r.season] ?? 0) + 1));
  console.log('player_season_clubs rows by season:', counts);
}

// leagues state
const { data: leagues } = await admin.from('leagues').select('id, name, status, current_season, previous_season');
console.log('leagues:', leagues);
