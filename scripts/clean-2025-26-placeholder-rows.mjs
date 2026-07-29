/**
 * Removes 2025-26 player_stats rows that describe no match.
 *
 * The old live sync minted a DNP row for anyone with no `explain` block, using
 * `playerFixIds[0]` — the first fixture of whichever club players.pl_team_id
 * pointed at. That id is seasonal and gets overwritten, so for some players the
 * placeholder ended up carrying another club's fixture id. Jacob Ramsey has
 * four: a zero-minute row against a Newcastle fixture he has no connection to,
 * sitting in the same gameweek as the match he actually played.
 *
 * A row is removed only when all three hold:
 *   • zero minutes, so no scoring data is lost;
 *   • its match_id is not one of that club's fixtures in that gameweek, so it
 *     names nothing; and
 *   • the player already has a row for that gameweek, so the gameweek is still
 *     represented.
 *
 * Usage: node scripts/clean-2025-26-placeholder-rows.mjs [--apply]
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SEASON = '2025-26';

const envPath = path.resolve('.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[trimmed.slice(0, eq).trim()] = val;
  }
}

const APPLY = process.argv.includes('--apply');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function page(table, select, apply = (q) => q) {
  const out = [];
  for (let p = 0; ; p++) {
    const { data, error } = await apply(supabase.from(table).select(select)).range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const fixtures = await page('pl_fixtures', 'fpl_fixture_id, gameweek, home_club, away_club',
  (q) => q.eq('season', SEASON));
const seasonClubs = await page('player_season_clubs', 'player_id, club_slug', (q) => q.eq('season', SEASON));
const stats = await page('player_stats', 'id, player_id, gameweek, match_id, stats', (q) => q.eq('season', SEASON));
const players = await page('players', 'id, name');

const nameById = new Map(players.map((p) => [p.id, p.name]));
const clubOf = new Map(seasonClubs.map((r) => [r.player_id, r.club_slug]));

// club → gameweek → the fixture ids it actually played
const clubFixtures = new Map();
for (const f of fixtures) {
  for (const club of [f.home_club, f.away_club]) {
    if (!clubFixtures.has(club)) clubFixtures.set(club, new Map());
    const byGw = clubFixtures.get(club);
    if (!byGw.has(f.gameweek)) byGw.set(f.gameweek, new Set());
    byGw.get(f.gameweek).add(f.fpl_fixture_id);
  }
}

const rowsByPlayerGw = new Map();
for (const r of stats) {
  const key = `${r.player_id}|${r.gameweek}`;
  if (!rowsByPlayerGw.has(key)) rowsByPlayerGw.set(key, []);
  rowsByPlayerGw.get(key).push(r);
}

const doomed = [];
for (const r of stats) {
  if (Number(r.stats?.minutes_played ?? 0) > 0) continue;
  const club = clubOf.get(r.player_id);
  if (!club) continue;
  const legitimate = clubFixtures.get(club)?.get(r.gameweek);
  if (legitimate?.has(r.match_id)) continue;
  const siblings = rowsByPlayerGw.get(`${r.player_id}|${r.gameweek}`) ?? [];
  if (siblings.length < 2) continue;
  doomed.push({ id: r.id, player: nameById.get(r.player_id), gw: r.gameweek, match_id: r.match_id });
}

const byPlayer = new Map();
for (const d of doomed) byPlayer.set(d.player, (byPlayer.get(d.player) ?? 0) + 1);

console.log(`${doomed.length} placeholder rows name no match of their club's and duplicate a gameweek\n`);
console.table([...byPlayer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .map(([player, rows]) => ({ player, rows })));

if (!APPLY) {
  console.log('\ndry run — pass --apply to delete.');
  process.exit(0);
}

for (let i = 0; i < doomed.length; i += 100) {
  const ids = doomed.slice(i, i + 100).map((d) => d.id);
  const { error } = await supabase.from('player_stats').delete().in('id', ids);
  if (error) throw new Error(`delete: ${error.message}`);
}
console.log(`deleted ${doomed.length} rows`);
