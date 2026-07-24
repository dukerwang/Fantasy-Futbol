process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Load canonical 2025-26 precomputed stats
const archivedStatsFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'season', 'archived_stats_2025_26.ts'), 'utf-8');
const jsonMatch = archivedStatsFile.match(/export const PRECOMPUTED_STATS_2025_26 = ({[\s\S]*});/);
let canonical2025_26 = [];
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[1]);
  canonical2025_26 = parsed.players || [];
}

async function fetchAll(table, select, filters = {}) {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function auditAndFixStatsPage() {
  console.log('=== AUDIT: player_stats season values & fantasy_points correctness ===\n');

  // 1. Check what season values are in player_stats
  const allStats = await fetchAll('player_stats', 'player_id, season, gameweek, match_id, fantasy_points, match_rating, stats');
  console.log(`Total player_stats rows: ${allStats.length}`);

  const seasonCounts = {};
  allStats.forEach(r => {
    seasonCounts[r.season] = (seasonCounts[r.season] || 0) + 1;
  });
  console.log('Rows by season:', seasonCounts);

  // 2. For the current season (2025-26), compute actual PPG per player from player_stats
  // vs what the canonical spec says
  const TARGET_SEASON = '2025-26';
  const season2526Stats = allStats.filter(r => r.season === TARGET_SEASON);
  console.log(`\nRows in '${TARGET_SEASON}': ${season2526Stats.length}`);

  // Group by player_id: sum fantasy_points, count gp (only where minutes > 0)
  const playerAgg = new Map();
  for (const r of season2526Stats) {
    const mins = Number(r.stats?.minutes_played ?? 0);
    if (mins <= 0) continue; // Stats page skips 0-minute appearances
    if (!playerAgg.has(r.player_id)) {
      playerAgg.set(r.player_id, { gp: 0, total_pts: 0 });
    }
    const agg = playerAgg.get(r.player_id);
    agg.gp += 1;
    agg.total_pts += Number(r.fantasy_points ?? 0);
  }

  // Compare to canonical
  const canonById = new Map(canonical2025_26.map(p => [p.id, p]));
  console.log('\nPPG discrepancies (computed from DB player_stats vs canonical 2025/26 spec):');
  let mismatchCount = 0;
  const mismatchedPlayers = [];

  for (const [pid, agg] of playerAgg) {
    const c = canonById.get(pid);
    if (!c) continue;

    const computedPpg = agg.gp > 0 ? agg.total_pts / agg.gp : 0;
    const canonPpg = c.ppg || 0;
    const diff = Math.abs(computedPpg - canonPpg);

    if (diff > 0.5) {
      console.log(`  "${c.name}": DB-computed ppg=${computedPpg.toFixed(2)} (gp=${agg.gp}, pts=${agg.total_pts.toFixed(2)}) vs canonical ppg=${canonPpg} (canonical total_pts=${c.total_points})`);
      mismatchCount++;
      mismatchedPlayers.push({ pid, name: c.name, dbGp: agg.gp, dbPts: agg.total_pts, dbComputedPpg: computedPpg, canonPpg, canonTotalPts: c.total_points, canonGp: Math.round(c.total_points / c.ppg) });
    }
  }

  console.log(`\nTotal PPG-mismatched players: ${mismatchCount}`);

  // 3. Check season_player_stats_archive for the same season
  const archives = await fetchAll('season_player_stats_archive', 'player_id, ppg, form_rating, overall_rank, total_points', { season: TARGET_SEASON });
  console.log(`\nseason_player_stats_archive rows for '${TARGET_SEASON}': ${archives.length}`);

  // Check Bruno Fernandes archive vs DB stats
  const brunoCanonical = canonical2025_26.find(p => p.name === 'Bruno Fernandes');
  const brunoArchive = archives.find(a => a.player_id === brunoCanonical?.id);
  const brunoDbAgg = playerAgg.get(brunoCanonical?.id);
  console.log(`\nBruno Fernandes:`);
  console.log(`  Archive: ppg=${brunoArchive?.ppg}, total_points=${brunoArchive?.total_points}`);
  console.log(`  DB computed from player_stats: ppg=${brunoDbAgg ? (brunoDbAgg.total_pts / brunoDbAgg.gp).toFixed(2) : 'N/A'}, gp=${brunoDbAgg?.gp}, pts=${brunoDbAgg?.total_pts?.toFixed(2)}`);
  console.log(`  Canonical spec: ppg=${brunoCanonical?.ppg}, total_points=${brunoCanonical?.total_points}`);

  // 4. Spot check which player_stats rows for Bruno have what fantasy_points
  const brunoStats = season2526Stats.filter(r => r.player_id === brunoCanonical?.id && Number(r.stats?.minutes_played ?? 0) > 0);
  const brunoSum = brunoStats.reduce((s, r) => s + Number(r.fantasy_points ?? 0), 0);
  console.log(`  DB rows with minutes: ${brunoStats.length}, sum of fantasy_points: ${brunoSum.toFixed(2)}`);

  if (mismatchCount === 0) {
    console.log('\n✅ player_stats fantasy_points are consistent with canonical PPG');
  } else {
    console.log(`\n❌ ${mismatchCount} players have fantasy_points in player_stats that don't match canonical PPG`);
    console.log('The root issue is that the player_stats rows themselves have wrong fantasy_points values.');
    console.log('This can only be fixed by re-running the sync/stats route to recalculate them from raw FPL data.');
  }
}

auditAndFixStatsPage().catch(console.error);
