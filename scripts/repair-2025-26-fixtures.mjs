/**
 * One-time repair of pl_fixtures for 2025-26.
 *
 * The rows in that table were not written by upsertFplFixtures() — they were
 * reconstructed by an earlier repair that handed out fixture ids sequentially
 * by kickoff time and bucketed ten matches per gameweek. The clubs and scores
 * are right; the ids and the gameweek labels are fiction:
 *
 *   stored : id 330, gameweek 34, brighton 3-0 chelsea, ko 21 Apr
 *   FPL    : id 333, gameweek 33, brighton 3-0 chelsea, ko 21 Apr
 *
 * 2025-26 really had 8 fixtures in GW31, 13 in GW33 and 7 in GW34. Flattening
 * that to ten-a-week put matches in gameweeks they were never played in, which
 * is why a player card showed "GW34 CHE (H) DNP" for a club that had a blank
 * gameweek, and labelled the goal he did score against Chelsea as a different
 * fixture entirely.
 *
 * FPL's own feed only serves the current season, so the repair source is the
 * community season archive (vaastav/Fantasy-Premier-League), which is a
 * verbatim copy of that feed. 2026-27 onwards is written live by
 * snapshotCurrentFplFixtures() and needs none of this.
 *
 * Usage:
 *   node scripts/repair-2025-26-fixtures.mjs <fixtures.csv> <teams.csv> [--apply]
 *
 * Without --apply it prints the diff and writes nothing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SEASON = '2025-26';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Same club list the app's registry reads — clubs.json is data, not TypeScript,
 * precisely so a script and the app can never disagree about a slug. Do not
 * parse registry.ts here.
 */
const CLUBS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/clubs/clubs.json'), 'utf8'));
const byLookup = new Map();
for (const club of CLUBS) {
  byLookup.set(club.slug, club);
  byLookup.set(club.name.toLowerCase(), club);
  byLookup.set(club.shortName.toLowerCase(), club);
  for (const alias of club.aliases) byLookup.set(alias.toLowerCase(), club);
}
const resolveClub = (name) => byLookup.get(String(name ?? '').trim().toLowerCase()) ?? null;

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

const [fixturesCsv, teamsCsv] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
if (!fixturesCsv || !teamsCsv) {
  console.error('usage: repair-2025-26-fixtures.mjs <fixtures.csv> <teams.csv> [--apply]');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(header.map((k, i) => [k, cells[i]]));
  });
}

const teams = readCsv(teamsCsv);
const fixtures = readCsv(fixturesCsv);

// Seasonal team ids mean nothing outside the payload they arrived in, so they
// are resolved to slugs here and never stored.
const slugById = new Map();
for (const t of teams) {
  const club = resolveClub(t.name);
  if (!club) {
    console.error(`unrecognised club in teams.csv: ${t.name}`);
    process.exit(1);
  }
  slugById.set(t.id, club.slug);
}

const rows = [];
let skipped = 0;
for (const f of fixtures) {
  const home = slugById.get(f.team_h);
  const away = slugById.get(f.team_a);
  const gameweek = Number(f.event);
  if (!gameweek || !home || !away || home === away) { skipped++; continue; }
  rows.push({
    season: SEASON,
    fpl_fixture_id: Number(f.id),
    gameweek,
    home_club: home,
    away_club: away,
    home_score: f.team_h_score === '' ? null : Number(f.team_h_score),
    away_score: f.team_a_score === '' ? null : Number(f.team_a_score),
    finished: f.finished === 'True' || f.finished === 'true',
    kickoff_time: f.kickoff_time || null,
    updated_at: new Date().toISOString(),
  });
}

const perGw = new Map();
for (const r of rows) perGw.set(r.gameweek, (perGw.get(r.gameweek) ?? 0) + 1);

const { data: existing, error: readErr } = await supabase
  .from('pl_fixtures').select('fpl_fixture_id, gameweek, home_club, away_club').eq('season', SEASON);
if (readErr) throw readErr;

const existingPerGw = new Map();
for (const r of existing) existingPerGw.set(r.gameweek, (existingPerGw.get(r.gameweek) ?? 0) + 1);

console.log(`archive: ${rows.length} fixtures (${skipped} skipped) | stored: ${existing.length}`);
console.log('\ngameweeks where the count differs:');
for (let gw = 1; gw <= 38; gw++) {
  const a = perGw.get(gw) ?? 0;
  const b = existingPerGw.get(gw) ?? 0;
  if (a !== b) console.log(`  GW${gw}: stored ${b} → correct ${a}`);
}

const existingById = new Map(existing.map((r) => [r.fpl_fixture_id, r]));
let moved = 0;
for (const r of rows) {
  const prev = existingById.get(r.fpl_fixture_id);
  if (!prev) continue;
  if (prev.gameweek !== r.gameweek || prev.home_club !== r.home_club || prev.away_club !== r.away_club) moved++;
}
console.log(`\n${moved} of ${rows.length} fixture ids currently describe a different match or gameweek.`);

if (!APPLY) {
  console.log('\ndry run — pass --apply to rewrite the season.');
  process.exit(0);
}

// The ids themselves are wrong, so upserting on (season, fixture) would leave
// the fabricated rows behind. Replace the season wholesale.
const { error: delErr } = await supabase.from('pl_fixtures').delete().eq('season', SEASON);
if (delErr) throw delErr;

for (let i = 0; i < rows.length; i += 200) {
  const { error } = await supabase.from('pl_fixtures').insert(rows.slice(i, i + 200));
  if (error) throw error;
}
console.log(`\nrewrote ${rows.length} fixtures for ${SEASON}.`);
