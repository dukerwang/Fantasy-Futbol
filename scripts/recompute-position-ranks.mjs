/**
 * Standalone positional-rank recompute — the same work as
 * POST /api/admin/recompute-position-ranks, without needing the app running.
 *
 * Ranks each position pool on points scored AT that position (secondaries
 * re-scored under their own weights, appearances under 15 minutes excluded),
 * which is what the stats leaderboard displays. See migration 085 for why this
 * cannot be derived in SQL.
 *
 * Writes season_player_stats_archive.position_ranks for an archived season,
 * players.position_ranks for the live one.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/recompute-position-ranks.mjs <season>
 */
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

const SEASON = process.argv[2];
if (!SEASON) {
  console.error('usage: recompute-position-ranks.mjs <season>');
  process.exit(1);
}

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

/** Same overlay pattern as loadReferenceStats() in src/lib/scoring/matchups.ts */
async function loadRefStats() {
  const { data: seasons } = await supabase
    .from('rating_reference_stats').select('season').order('season', { ascending: false }).limit(1);
  const refSeason = seasons?.[0]?.season ?? SEASON;
  const { data } = await supabase
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', refSeason);
  const ref = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  for (const row of data ?? []) {
    if (ref[row.position_group]?.[row.component]) {
      ref[row.position_group][row.component] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return { ref, refSeason };
}

const archives = await page('season_player_stats_archive', 'player_id', (q) => q.eq('season', SEASON));
const allPlayers = await page('players', 'id, primary_position, secondary_positions, is_active');
const statRows = await page('player_stats', 'player_id, match_rating, fantasy_points, stats',
  (q) => q.eq('season', SEASON));
const { ref, refSeason } = await loadRefStats();

// Rank over exactly the pool the season's leaderboard renders: everyone with an
// archive row once the season is frozen, active players while it is live.
const archived = archives.length > 0;
const archivedIds = new Set(archives.map((a) => a.player_id));
const pool = allPlayers.filter((p) => (archived ? archivedIds.has(p.id) : p.is_active));
const playerMap = new Map(pool.map((p) => [p.id, p]));

const aggregates = buildPositionAggregates(statRows, playerMap, ref, MEANINGFUL_MINUTES);
const ranks = rankPositionAggregates(aggregates);
const payload = pool.map((p) => ({ player_id: p.id, position_ranks: ranks.get(p.id) ?? [] }));

console.log(`${SEASON} | archived: ${archived} | pool ${pool.length} | ${statRows.length} stat rows | reference stats ${refSeason}`);

const { data, error } = archived
  ? await supabase.rpc('apply_archive_position_ranks', { p_season: SEASON, p_payload: payload })
  : await supabase.rpc('apply_player_position_ranks', { p_payload: payload });
if (error) throw new Error(error.message);

console.log(`ranked ${ranks.size} players, wrote ${data} rows`);
