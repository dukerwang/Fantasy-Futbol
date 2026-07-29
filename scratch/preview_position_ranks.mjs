// Dry-run preview of the re-scored positional ranks introduced by migration
// 085 — computes exactly what recomputePositionRanks() would persist, without
// writing anything, and diffs it against the ranks currently stored.
//
// Run with: node --experimental-strip-types --no-warnings scratch/preview_position_ranks.mjs [season]
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating.ts';
import {
  MEANINGFUL_MINUTES,
  buildPositionAggregates,
  rankPositionAggregates,
} from '../src/lib/scoring/positionAggregates.ts';

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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = process.argv[2] ?? '2025-26';

async function fetchAll(table, select, apply = (q) => q) {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await apply(supabase.from(table).select(select)).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/** Same overlay as loadReferenceStats() in src/lib/scoring/matchups.ts */
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

const archives = await fetchAll('season_player_stats_archive', 'player_id, total_points, position_ranks', (q) => q.eq('season', SEASON));
const allPlayers = await fetchAll('players', 'id, name, primary_position, secondary_positions, is_active');
const statRows = await fetchAll('player_stats', 'player_id, match_rating, fantasy_points, stats', (q) => q.eq('season', SEASON));
const refStats = await loadRefStats(SEASON);

const archived = archives.length > 0;
const archiveMap = new Map(archives.map((a) => [a.player_id, a]));
const pool = allPlayers.filter((p) => (archived ? archiveMap.has(p.id) : p.is_active));
const playerMap = new Map(pool.map((p) => [p.id, p]));

console.log(`season ${SEASON} | archived: ${archived} | pool: ${pool.length} players | ${statRows.length} stat rows\n`);

const agg = buildPositionAggregates(statRows, playerMap, refStats, MEANINGFUL_MINUTES);
const ranks = rankPositionAggregates(agg);

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

for (const pos of POSITIONS.filter((p) => ['ST', 'AM'].includes(p))) {
  const rows = [];
  for (const [pid, list] of ranks) {
    const entry = list.find((r) => r.position === pos);
    if (!entry) continue;
    const p = playerMap.get(pid);
    const old = (archiveMap.get(pid)?.position_ranks ?? []).find((r) => r.position === pos);
    rows.push({
      rank: entry.rank,
      name: p.name,
      role: p.primary_position === pos ? 'primary' : `sec (${p.primary_position})`,
      pts_at_pos: Number(agg[pid][pos].total_points.toFixed(2)),
      gp: agg[pid][pos].gp,
      old_rank: old?.rank ?? '—',
    });
  }
  rows.sort((a, b) => a.rank - b.rank);
  console.log(`=== ${pos} — new re-scored top 10 ===`);
  console.table(rows.slice(0, 10));
}

// Movement summary across every position
let moved = 0;
let total = 0;
for (const [pid, list] of ranks) {
  const old = archiveMap.get(pid)?.position_ranks ?? [];
  for (const entry of list) {
    total++;
    const prev = old.find((r) => r.position === entry.position);
    if (!prev || prev.rank !== entry.rank) moved++;
  }
}
console.log(`\n${moved} of ${total} (player, position) ranks change.`);
