// Regenerates src/lib/season/archived_stats_2025_26.ts (the pre-computed
// snapshot served by /share/stats for the completed 2025-26 season) using the
// REAL scoring engine (src/lib/scoring/matchRating.ts), not a reimplementation.
//
// The aggregation and ranking now come from src/lib/scoring/positionAggregates.ts,
// the same module the live pages and recomputePositionRanks() use, so the
// snapshot cannot drift from them. Two things changed with migration 085:
//
//   • the pool is every player with a 2025-26 archive row, including those who
//     have since left the league — they played the season, so they belong in
//     its record and in the ranks computed over it;
//   • position_ranks are computed here from per-position points rather than
//     copied from the archive, so the snapshot is correct even before the
//     migration's recompute has run.
//
// Club attribution comes from player_season_clubs, NOT players.pl_team.
// Sync overwrites pl_team every rollover, so reading it here would list
// Burnley leavers under Coventry / Hull / Ipswich (2026-27 promoted sides).
//
// Run with:
//   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs scratch/build_2025_26_json.mjs
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating.ts';
import {
  MEANINGFUL_MINUTES,
  buildPositionAggregates,
  rankPositionAggregates,
} from '../src/lib/scoring/positionAggregates.ts';

const clubs = JSON.parse(
  fs.readFileSync(path.resolve('src/lib/clubs/clubs.json'), 'utf8'),
);

/** FPL's seasonal team id for each club in 2025-26 (teams.csv id column). */
const FPL_TEAM_ID_2025_26 = {
  arsenal: 1,
  'aston-villa': 2,
  burnley: 3,
  bournemouth: 4,
  brentford: 5,
  brighton: 6,
  chelsea: 7,
  'crystal-palace': 8,
  everton: 9,
  fulham: 10,
  leeds: 11,
  liverpool: 12,
  'man-city': 13,
  'man-utd': 14,
  newcastle: 15,
  'nottingham-forest': 16,
  sunderland: 17,
  spurs: 18,
  'west-ham': 19,
  wolves: 20,
};

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Same overlay pattern as loadReferenceStats() in src/lib/scoring/matchups.ts */
async function loadRefStats(season) {
  const { data } = await supabase
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', season);

  const ref = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  for (const row of data ?? []) {
    if (ref[row.position_group] && ref[row.position_group][row.component]) {
      ref[row.position_group][row.component] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return ref;
}

async function fetchAllPages(table, select, apply = (q) => q) {
  const out = [];
  const PAGE_SIZE = 1000;
  for (let page = 0; ; page++) {
    const { data, error } = await apply(supabase.from(table).select(select))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

async function buildArchivedDataset() {
  console.log('Generating pre-computed archived stats dataset for 2025-26...');
  const season = '2025-26';

  const FULL_PLAYER_SELECT = 'id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at';

  const clubBySlug = new Map(clubs.map((c) => [c.slug, c]));

  const [playersData, archives, allStats, refStats, seasonClubs] = await Promise.all([
    fetchAllPages('players', FULL_PLAYER_SELECT, (q) =>
      q.order('total_points', { ascending: false, nullsFirst: false })),
    fetchAllPages('season_player_stats_archive', 'player_id, total_points, ppg, form_rating, overall_rank', (q) =>
      q.eq('season', season)),
    fetchAllPages('player_stats', 'player_id, match_rating, fantasy_points, stats', (q) =>
      q.eq('season', season)),
    loadRefStats(season),
    fetchAllPages('player_season_clubs', 'player_id, club_slug', (q) => q.eq('season', season)),
  ]);

  const archiveMap = new Map(archives.map((a) => [a.player_id, a]));
  const seasonClubByPlayer = new Map(seasonClubs.map((r) => [r.player_id, r.club_slug]));
  const seasonClubNames = new Set(
    Object.keys(FPL_TEAM_ID_2025_26)
      .map((s) => clubBySlug.get(s)?.name)
      .filter(Boolean),
  );

  let clubOverrides = 0;
  let missingSeasonClub = 0;

  // The archived pool: everyone who scored in 2025-26, active or departed.
  const players = playersData
    .filter((p) => archiveMap.has(p.id))
    .map((p) => {
      const arch = archiveMap.get(p.id);
      const slug = seasonClubByPlayer.get(p.id);
      const club = slug ? clubBySlug.get(slug) : null;
      let pl_team = p.pl_team;
      let pl_team_id = p.pl_team_id;
      if (club) {
        if (pl_team !== club.name) clubOverrides++;
        pl_team = club.name;
        pl_team_id = FPL_TEAM_ID_2025_26[slug] ?? null;
      } else {
        missingSeasonClub++;
        // Do not keep a 2026-27 promoted club on a 2025-26 row — better blank
        // than Coventry/Hull/Ipswich on a season they were not in.
        if (!seasonClubNames.has(p.pl_team)) {
          pl_team = null;
          pl_team_id = null;
        }
      }
      return {
        ...p,
        pl_team,
        pl_team_id,
        total_points: Number(arch.total_points),
        ppg: Number(arch.ppg),
        form_rating: Number(arch.form_rating),
        overall_rank: arch.overall_rank,
        position_ranks: [],
        owner_team_id: null,
        owner_team_name: null,
      };
    });
  console.log(`Pool: ${players.length} archived players (${playersData.length} in the database).`);
  console.log(`Fetched ${allStats.length} player_stats rows for ${season}.`);
  console.log(`Club overrides from player_season_clubs: ${clubOverrides}; missing season club: ${missingSeasonClub}`);

  const playerMap = new Map(players.map((p) => [p.id, p]));

  const round = (agg) => {
    const out = {};
    for (const [pid, byPosition] of Object.entries(agg)) {
      out[pid] = {};
      for (const [pos, ex] of Object.entries(byPosition)) {
        out[pid][pos] = {
          gp: ex.gp,
          total_points: Number(ex.total_points.toFixed(2)),
          avg_rating: Number(ex.avg_rating.toFixed(2)),
          total_minutes: ex.total_minutes,
        };
      }
    }
    return out;
  };

  const meaningful = buildPositionAggregates(allStats, playerMap, refStats, MEANINGFUL_MINUTES);
  const shadowMaps = {
    played: round(buildPositionAggregates(allStats, playerMap, refStats, 1)),
    all: round(meaningful),
    gt45: round(buildPositionAggregates(allStats, playerMap, refStats, 45)),
  };

  // Ranks come from the same aggregate the table's default view renders.
  const ranks = rankPositionAggregates(meaningful);
  for (const p of players) {
    p.position_ranks = ranks.get(p.id) ?? [];
  }

  const fileContent = `/**
 * Pre-computed archived stats for 2025-26 season.
 * Auto-generated for instant page loads.
 */

export const PRECOMPUTED_STATS_2025_26 = ${JSON.stringify({ players, shadowMaps }, null, 2)};
`;

  fs.writeFileSync('src/lib/season/archived_stats_2025_26.ts', fileContent);
  console.log('Saved src/lib/season/archived_stats_2025_26.ts successfully!');

  const hist = {};
  for (const p of players) hist[p.pl_team ?? '(none)'] = (hist[p.pl_team ?? '(none)'] || 0) + 1;
  console.log('Club histogram:');
  for (const [club, n] of Object.entries(hist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${club}: ${n}`);
  }
}

buildArchivedDataset();
