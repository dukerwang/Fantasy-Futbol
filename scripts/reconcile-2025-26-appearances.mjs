/**
 * One-time reconciliation of the 2025-26 appearance record against FPL's own
 * season data, fixing two defects.
 *
 *   1. MISSING APPEARANCES. When a club played twice in one gameweek the live
 *      sync wrote the first match and then deleted it while writing the second:
 *      it decided whether a gameweek was a double by looking the club's
 *      fixtures up through players.pl_team_id, a seasonal id every player sync
 *      overwrites, and took the single-fixture path whenever that lookup came
 *      up short. 156 appearances across GW26, GW33 and GW36 were lost.
 *
 *   2. MISATTRIBUTED APPEARANCES. players.fpl_id was treated as an identity key
 *      across the 2026-27 rollover, but FPL reassigns element ids every summer.
 *      Nineteen rows were handed to whoever inherited their number and kept the
 *      previous player's history: our "Dominic Solanke" held Igor Jesus's
 *      GW1-21, our "Gabriel Martinelli" held most of Zubimendi's season.
 *
 * Both sync paths are fixed (sync/stats/route.ts, syncPlayers.ts); this repairs
 * the data they already wrote.
 *
 * Players are keyed on NAME. Neither numeric identifier survives the rollover:
 * fpl_id is reassigned by FPL, and photo_url — which embeds FPL's otherwise
 * stable player code — was itself overwritten for dozens of rows by the
 * fpl_id-keyed sync, so our "Ibrahima Konaté" now carries Endo Wataru's photo
 * code while holding Konaté's stats. Checked against the archive minute by
 * minute, the stored seasons follow the name, so the name is what we trust.
 *
 * Reconciliation per player, against the archive's appearances for them:
 *   • an appearance we hold → repointed at its real FPL fixture id
 *   • an appearance we lack → inserted, scored by the real engine
 *   • a player whose stored rows do not all correspond to an appearance →
 *     left completely untouched and reported. Those are the rows whose history
 *     was blended with another player's when FPL reused their element id, and
 *     no heuristic should be trusted to unpick them in place.
 *
 * Source: the community season archive (vaastav/Fantasy-Premier-League), a
 * verbatim copy of the FPL feed, which no longer serves past seasons.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/reconcile-2025-26-appearances.mjs <merged_gw.csv> <players_raw.csv> [--apply]
 *
 * Without --apply it reports what it would change and writes nothing.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, mapFplLiveToRawStats } from '../src/lib/scoring/engine.ts';
import { DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating.ts';

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

const [CSV, PLAYERS_CSV] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
if (!CSV || !PLAYERS_CSV) {
  console.error('usage: reconcile-2025-26-appearances.mjs <merged_gw.csv> <players_raw.csv> [--apply]');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** RFC4180-ish split — player names in this file contain commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(header.map((k, i) => [k, cells[i]]));
  });
}

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

/** Same overlay pattern as loadReferenceStats() in src/lib/scoring/matchups.ts */
async function loadRefStats(season) {
  const { data } = await supabase
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', season);
  const ref = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  for (const row of data ?? []) {
    if (ref[row.position_group]?.[row.component]) {
      ref[row.position_group][row.component] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return ref;
}

/** The archive's column names, in the shape mapFplLiveToRawStats() expects. */
function toFplLiveStats(row) {
  return {
    minutes: Number(row.minutes),
    goals_scored: Number(row.goals_scored),
    assists: Number(row.assists),
    clean_sheets: Number(row.clean_sheets),
    goals_conceded: Number(row.goals_conceded),
    saves: Number(row.saves),
    penalties_saved: Number(row.penalties_saved),
    penalties_missed: Number(row.penalties_missed),
    yellow_cards: Number(row.yellow_cards),
    red_cards: Number(row.red_cards),
    own_goals: Number(row.own_goals),
    bonus: Number(row.bonus),
    bps: Number(row.bps),
    influence: row.influence,
    creativity: row.creativity,
    threat: row.threat,
    ict_index: row.ict_index,
    expected_goals: row.expected_goals,
    expected_assists: row.expected_assists,
    expected_goals_conceded: row.expected_goals_conceded,
    tackles: Number(row.tackles ?? 0),
    clearances_blocks_interceptions: Number(row.clearances_blocks_interceptions ?? 0),
    recoveries: Number(row.recoveries ?? 0),
    defensive_contribution: Number(row.defensive_contribution ?? 0),
  };
}

/** Same normalisation the player sync uses, so both agree on who is who. */
function normalizeName(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le',
  'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'santos', 'silva', 'junior',
]);

function significantTokens(str) {
  return normalizeName(str).split(' ').filter((t) => t.length >= 3 && !NAME_PARTICLES.has(t));
}

const archive = readCsv(CSV);
const archivePlayers = readCsv(PLAYERS_CSV);
const statRows = await page('player_stats', 'id, player_id, gameweek, match_id, stats, fantasy_points',
  (q) => q.eq('season', SEASON));
const players = await page('players', 'id, name, primary_position, photo_url');
const playerById = new Map(players.map((p) => [p.id, p]));
const refStats = await loadRefStats(SEASON);

const rowsPerPlayer = new Map();
for (const r of statRows) rowsPerPlayer.set(r.player_id, (rowsPerPlayer.get(r.player_id) ?? 0) + 1);

// Duplicate records for one person: the twin already holding the season's rows
// wins — moving a whole season between twins would be churn for no gain.
const candidatesByName = new Map();
for (const p of players) {
  for (const key of new Set([normalizeName(p.name), significantTokens(p.name).sort().join(' ')])) {
    if (!key) continue;
    if (!candidatesByName.has(key)) candidatesByName.set(key, []);
    candidatesByName.get(key).push(p.id);
  }
}
const pickBest = (ids) => ids.reduce((a, b) => ((rowsPerPlayer.get(b) ?? 0) > (rowsPerPlayer.get(a) ?? 0) ? b : a));

// Element ids are seasonal, so they are only ever used to read the archive.
const playerByElement = new Map();
let unresolvedArchivePlayers = 0;
for (const ap of archivePlayers) {
  const fullName = `${ap.first_name} ${ap.second_name}`;
  const exact = candidatesByName.get(normalizeName(fullName));
  const byTokens = candidatesByName.get(significantTokens(fullName).sort().join(' '));
  const ids = exact ?? byTokens;
  if (!ids) { unresolvedArchivePlayers++; continue; }
  playerByElement.set(Number(ap.id), pickBest(ids));
}

const appearancesByPlayer = new Map();
let unmatchedArchiveRows = 0;
let duplicateArchiveRows = 0;
// merged_gw.csv is a concatenation of the per-gameweek files and repeats some
// (element, fixture) pairs. Left in, a duplicate is an appearance we can never
// satisfy: the insert upserts onto the row that already covers it, so the next
// run reports the same gap again.
const seenAppearances = new Set();
for (const row of archive) {
  if (Number(row.minutes) <= 0) continue;
  const playerId = playerByElement.get(Number(row.element));
  if (!playerId) { unmatchedArchiveRows++; continue; }
  const key = `${row.element}|${row.fixture}`;
  if (seenAppearances.has(key)) { duplicateArchiveRows++; continue; }
  seenAppearances.add(key);
  if (!appearancesByPlayer.has(playerId)) appearancesByPlayer.set(playerId, []);
  appearancesByPlayer.get(playerId).push(row);
}

const ourByPlayer = new Map();
for (const r of statRows) {
  if (!ourByPlayer.has(r.player_id)) ourByPlayer.set(r.player_id, []);
  ourByPlayer.get(r.player_id).push(r);
}

const inserts = [];
const repoints = [];
const blended = [];
const untracked = [];

for (const playerId of new Set([...appearancesByPlayer.keys(), ...ourByPlayer.keys()])) {
  const player = playerById.get(playerId);
  if (!player) continue;

  const appearances = appearancesByPlayer.get(playerId) ?? [];
  const held = (ourByPlayer.get(playerId) ?? []).filter((r) => Number(r.stats?.minutes_played ?? 0) > 0);

  // A player we cannot identify in the archive at all is left untouched — an
  // absent mapping is not evidence that a season did not happen.
  if (appearances.length === 0) continue;

  // Only records that already hold part of this season are repaired. A record
  // with none of it is either the empty half of a duplicate pair — the players
  // table has two rows for Murillo, two for Joelinton, two for Carlos Alcaraz,
  // and the season sits on the other one — or someone we never tracked. Filling
  // it in would write a second copy of a season we already have.
  if (held.length === 0) {
    if (appearances.length > 0) untracked.push({ player: player.name, appearances: appearances.length });
    continue;
  }

  const unclaimed = [...appearances];
  const claimedBy = new Map();

  const claim = (row, predicate) => {
    const idx = unclaimed.findIndex(predicate);
    if (idx < 0) return false;
    claimedBy.set(row.id, unclaimed[idx]);
    unclaimed.splice(idx, 1);
    return true;
  };

  // Real fixture id is exact; gameweek + minutes distinguishes the two halves
  // of a double; gameweek alone is the last resort.
  for (const row of held) claim(row, (a) => Number(a.fixture) === row.match_id);
  for (const row of held) {
    if (claimedBy.has(row.id)) continue;
    const mins = Number(row.stats?.minutes_played ?? -1);
    claim(row, (a) => Number(a.round) === row.gameweek && Number(a.minutes) === mins);
  }
  for (const row of held) {
    if (claimedBy.has(row.id)) continue;
    claim(row, (a) => Number(a.round) === row.gameweek);
  }

  // A stored appearance this player never made means the row's history was
  // blended with somebody else's. Adding the real season on top would leave the
  // record holding two players' matches, so the whole record is left alone.
  const orphans = held.filter((row) => !claimedBy.has(row.id));
  if (orphans.length > 0) {
    blended.push({
      player: player.name,
      unrecognised_rows: orphans.length,
      missing_appearances: unclaimed.length,
    });
    continue;
  }

  for (const [rowId, appearance] of claimedBy) {
    const row = held.find((r) => r.id === rowId);
    const realId = Number(appearance.fixture);
    if (row.match_id !== realId) repoints.push({ id: rowId, to: realId });
  }

  for (const appearance of unclaimed) {
    const rawStats = mapFplLiveToRawStats(toFplLiveStats(appearance));
    const rating = calculateMatchRating(rawStats, player.primary_position, refStats);
    inserts.push({
      player_id: playerId,
      match_id: Number(appearance.fixture),
      gameweek: Number(appearance.round),
      season: SEASON,
      stats: rawStats,
      fantasy_points: rating.fantasyPoints,
      match_rating: rating.rating,
    });
  }
}

const insertsByGw = new Map();
for (const i of inserts) {
  const b = insertsByGw.get(i.gameweek) ?? { gw: i.gameweek, appearances: 0, points: 0 };
  b.appearances++;
  b.points += i.fantasy_points;
  insertsByGw.set(i.gameweek, b);
}

console.log(`archive rows ${archive.length} | stored rows ${statRows.length}`);
console.log(`archive players we could not match by name: ${unresolvedArchivePlayers} | their rows: ${unmatchedArchiveRows}`);
console.log(`\ninsert ${inserts.length} appearances | repoint ${repoints.length} match_ids | skip ${blended.length} players with blended history\n`);
console.table([...insertsByGw.values()].sort((a, b) => a.gw - b.gw).map((b) => ({
  gw: b.gw, appearances: b.appearances, fantasy_points: Number(b.points.toFixed(1)),
})));

console.log(`\n${untracked.length} records hold none of this season and were left empty (duplicate twins / never tracked)`);
console.log('\nplayers left untouched — stored rows that match no appearance of theirs:');
console.table(blended.sort((a, b) => b.unrecognised_rows - a.unrecognised_rows).slice(0, 30));

if (!APPLY) {
  console.log('\ndry run — pass --apply to write.');
  process.exit(0);
}

for (let i = 0; i < repoints.length; i += 100) {
  await Promise.all(repoints.slice(i, i + 100).map((r) =>
    supabase.from('player_stats').update({ match_id: r.to }).eq('id', r.id).then(({ error }) => {
      if (error) throw new Error(`repoint ${r.id}: ${error.message}`);
    })));
  process.stdout.write(`\rrepointed ${Math.min(i + 100, repoints.length)}/${repoints.length}`);
}
console.log('');

for (let i = 0; i < inserts.length; i += 200) {
  const { error } = await supabase.from('player_stats')
    .upsert(inserts.slice(i, i + 200), { onConflict: 'player_id,match_id' });
  if (error) throw new Error(`insert: ${error.message}`);
}
console.log(`inserted ${inserts.length} appearances`);

// Season totals, PPG and form all derive from player_stats.
for (const rpc of ['update_player_fantasy_scores', 'update_player_form_ratings']) {
  const { error } = await supabase.rpc(rpc, { p_season: SEASON });
  if (error) throw new Error(`${rpc}: ${error.message}`);
  console.log(`ran ${rpc}`);
}

const { error: archiveErr } = await supabase.rpc('archive_player_season_stats', { p_season: SEASON });
if (archiveErr) throw new Error(`archive_player_season_stats: ${archiveErr.message}`);
console.log('re-archived the season');
console.log('\nNext: recompute positional ranks, then regenerate the /share/stats snapshot.');
