/**
 * Rebuilds the 2025-26 season for players whose stat history was blended with
 * somebody else's when FPL reused their element id at the rollover.
 *
 * The reconciliation script deliberately refuses to touch these: a record whose
 * stored rows are two players' matches interleaved cannot be unpicked by
 * matching heuristics, and adding the real season on top would leave it holding
 * both. Rebuilding wholesale is the only safe repair — delete the record's
 * 2025-26 rows and re-insert exactly the appearances the archive lists for that
 * player, scored by the real engine.
 *
 * Our "Gabriel Martinelli" is one: it held most of Martín Zubimendi's season
 * (element 26 in 2025-26, Martinelli's number in 2026-27) alongside a handful
 * of Martinelli's own matches, while the Zubimendi record sat empty.
 *
 * Pass the names as they appear in the players table. Every named record is
 * rebuilt from its own archive season, so both sides of a swap can be repaired
 * in one run.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/repair-blended-player-history.mjs <merged_gw.csv> <players_raw.csv> \
 *     --players "Gabriel Martinelli,Martín Zubimendi Ibáñez" [--apply]
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
const playersArg = process.argv[process.argv.indexOf('--players') + 1];
if (!CSV || !PLAYERS_CSV || !playersArg || playersArg.startsWith('--')) {
  console.error('usage: repair-blended-player-history.mjs <merged_gw.csv> <players_raw.csv> --players "A,B" [--apply]');
  process.exit(1);
}
const targetNames = playersArg.split(',').map((s) => s.trim()).filter(Boolean);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

const normalize = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const archive = readCsv(CSV);
const archivePlayers = readCsv(PLAYERS_CSV);
const refStats = await loadRefStats(SEASON);

for (const targetName of targetNames) {
  const { data: player, error } = await supabase
    .from('players').select('id, name, primary_position').eq('name', targetName).maybeSingle();
  if (error) throw new Error(error.message);
  if (!player) { console.log(`\n${targetName}: no such player record — skipped`); continue; }

  // The archive spells names more fully than we do ("Gabriel Martinelli Silva"
  // for our "Gabriel Martinelli"), so an exact match is tried first and a
  // subset of significant tokens second. Ambiguity is refused rather than
  // guessed — rebuilding the wrong player would erase a correct season.
  const tokens = (s) => normalize(s).split(' ').filter((t) => t.length >= 3 &&
    !['dos', 'das', 'van', 'von', 'del', 'silva', 'santos', 'junior'].includes(t));
  const targetTokens = tokens(targetName);
  let entry = archivePlayers.find((p) => normalize(`${p.first_name} ${p.second_name}`) === normalize(targetName));
  if (!entry) {
    const candidates = archivePlayers.filter((p) => {
      const theirs = tokens(`${p.first_name} ${p.second_name}`);
      return targetTokens.length > 0 && targetTokens.every((t) => theirs.includes(t));
    });
    if (candidates.length > 1) {
      console.log(`\n${targetName}: ${candidates.length} archive players match that name — skipped`);
      continue;
    }
    entry = candidates[0];
  }
  if (!entry) { console.log(`\n${targetName}: not in the 2025-26 archive — skipped`); continue; }

  const seen = new Set();
  const appearances = archive.filter((r) => {
    if (Number(r.element) !== Number(entry.id) || Number(r.minutes) <= 0) return false;
    if (seen.has(r.fixture)) return false;
    seen.add(r.fixture);
    return true;
  });

  const { data: current } = await supabase
    .from('player_stats').select('id, gameweek, match_id, stats')
    .eq('player_id', player.id).eq('season', SEASON);

  const heldPlayed = (current ?? []).filter((r) => Number(r.stats?.minutes_played ?? 0) > 0);
  console.log(`\n=== ${player.name} (element ${entry.id}) ===`);
  console.log(`  stored: ${current?.length ?? 0} rows (${heldPlayed.length} appearances) → rebuild as ${appearances.length} appearances`);

  if (!APPLY) continue;

  const { error: delErr } = await supabase
    .from('player_stats').delete().eq('player_id', player.id).eq('season', SEASON);
  if (delErr) throw new Error(`delete ${player.name}: ${delErr.message}`);

  const rows = appearances.map((r) => {
    const rawStats = mapFplLiveToRawStats(toFplLiveStats(r));
    const rating = calculateMatchRating(rawStats, player.primary_position, refStats);
    return {
      player_id: player.id,
      match_id: Number(r.fixture),
      gameweek: Number(r.round),
      season: SEASON,
      stats: rawStats,
      fantasy_points: rating.fantasyPoints,
      match_rating: rating.rating,
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    const { error: insErr } = await supabase.from('player_stats')
      .upsert(rows.slice(i, i + 200), { onConflict: 'player_id,match_id' });
    if (insErr) throw new Error(`insert ${player.name}: ${insErr.message}`);
  }
  console.log(`  rebuilt with ${rows.length} appearances`);
}

if (!APPLY) {
  console.log('\ndry run — pass --apply to rebuild.');
  process.exit(0);
}

for (const rpc of ['update_player_fantasy_scores', 'update_player_form_ratings']) {
  const { error } = await supabase.rpc(rpc, { p_season: SEASON });
  if (error) throw new Error(`${rpc}: ${error.message}`);
  console.log(`ran ${rpc}`);
}
const { error: archiveErr } = await supabase.rpc('archive_player_season_stats', { p_season: SEASON });
if (archiveErr) throw new Error(`archive_player_season_stats: ${archiveErr.message}`);
console.log('re-archived the season');
