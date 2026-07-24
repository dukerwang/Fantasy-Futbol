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

// Paginated fetch for player_stats
async function fetchAllPlayerStats() {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('id, player_id, season, gameweek, match_id, match_rating, fantasy_points, created_at')
      .range(from, from + pageSize - 1)
      .order('player_id');
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

// Paginated fetch for players
async function fetchAllDbPlayers() {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, ppg, total_points, form_rating, form')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function deepFixPlayerStats() {
  console.log('=== DEEP FIX: player_stats DUPLICATES + players.stats RESTORE ===\n');

  // 1. Fetch ALL player_stats rows (paginated)
  console.log('Fetching all player_stats rows...');
  const allStats = await fetchAllPlayerStats();
  console.log(`Total player_stats rows fetched: ${allStats.length}`);

  // 2. Group by player_id + season + gameweek to find duplicates
  // (same player, same season, same gameweek = duplicate from merged orphan)
  const grouped = new Map();
  for (const row of allStats) {
    const key = `${row.player_id}|${row.season}|${row.gameweek}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const duplicateEntries = Array.from(grouped.entries()).filter(([_, rows]) => rows.length > 1);
  console.log(`Duplicate player_id+season+gameweek combos: ${duplicateEntries.length}`);

  if (duplicateEntries.length > 0) {
    // Collect affected player ids for reporting
    const playerIds = [...new Set(duplicateEntries.map(([key]) => key.split('|')[0]))];
    const nameMap = new Map();
    for (let i = 0; i < playerIds.length; i += 20) {
      const batch = playerIds.slice(i, i + 20);
      const { data: ps } = await supabase.from('players').select('id, name').in('id', batch);
      ps?.forEach(p => nameMap.set(p.id, p.name));
    }

    // Group extra rows by player for reporting
    const byPlayer = new Map();
    for (const [key, rows] of duplicateEntries) {
      const pid = key.split('|')[0];
      byPlayer.set(pid, (byPlayer.get(pid) || 0) + (rows.length - 1));
    }
    console.log('\nAffected players and extra row counts:');
    for (const [pid, extraCount] of [...byPlayer.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  "${nameMap.get(pid) || pid}": +${extraCount} duplicate rows`);
    }

    // Delete the lower-quality duplicate rows
    console.log('\n--- Deleting duplicate player_stats rows ---');
    let deleted = 0;
    for (const [key, rows] of duplicateEntries) {
      // Keep the row with the most data (non-null match_rating), then by newest created_at
      rows.sort((a, b) => {
        const aScore = (a.match_rating !== null ? 2 : 0) + (a.fantasy_points !== null ? 1 : 0);
        const bScore = (b.match_rating !== null ? 2 : 0) + (b.fantasy_points !== null ? 1 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      const toDelete = rows.slice(1);
      for (const r of toDelete) {
        const { error } = await supabase.from('player_stats').delete().eq('id', r.id);
        if (!error) deleted++;
        else console.error(`  Error deleting ${r.id}:`, error.message);
      }
    }
    console.log(`Deleted ${deleted} duplicate player_stats rows.\n`);
  }

  // 3. Restore players table ppg/total_points/form_rating from canonical 2025/26 spec
  // These are the SOURCE OF TRUTH values from the end of 2025/26 season
  console.log('=== Restoring players.ppg/total_points/form_rating from canonical spec ===');
  const allDbPlayers = await fetchAllDbPlayers();
  const canonById = new Map(canonical2025_26.map(p => [p.id, p]));
  let statsRestored = 0;

  for (const p of allDbPlayers) {
    const c = canonById.get(p.id);
    if (!c) continue;

    const ppgMismatch = Math.abs((p.ppg || 0) - (c.ppg || 0)) > 0.01;
    const ptsMismatch = Math.abs((p.total_points || 0) - (c.total_points || 0)) > 0.01;
    const formMismatch = Math.abs((p.form_rating || 0) - (c.form_rating || 0)) > 0.01;

    if (ppgMismatch || ptsMismatch || formMismatch) {
      console.log(`  Restoring "${p.name}": ppg ${p.ppg}->${c.ppg}, total_pts ${p.total_points}->${c.total_points}, form_rating ${p.form_rating}->${c.form_rating}`);
      const { error } = await supabase.from('players').update({
        ppg: c.ppg,
        total_points: c.total_points,
        form_rating: c.form_rating,
        updated_at: new Date().toISOString()
      }).eq('id', p.id);
      if (!error) statsRestored++;
      else console.error(`  Error updating ${p.id}:`, error.message);
    }
  }
  console.log(`Restored stats for ${statsRestored} players.\n`);

  // 4. Final verification
  console.log('=== FINAL VERIFICATION ===');
  const finalStats = await fetchAllPlayerStats();
  const finalGrouped = new Map();
  finalStats.forEach(r => {
    const key = `${r.player_id}|${r.season}|${r.gameweek}`;
    finalGrouped.set(key, (finalGrouped.get(key) || 0) + 1);
  });
  const remainingDups = Array.from(finalGrouped.values()).filter(c => c > 1).length;

  // Spot-check several known-affected players
  const checks = ['Bruno Fernandes', 'Bryan Mbeumo', 'Gabriel Martinelli', 'Lewis Hall'];
  for (const name of checks) {
    const c = canonical2025_26.find(p => p.name === name);
    if (!c) continue;
    const rowCount = finalStats.filter(r => r.player_id === c.id).length;
    const { data: dbRow } = await supabase.from('players').select('name, ppg, total_points, form_rating').eq('id', c.id).single();
    console.log(`${name}: ${rowCount} stat rows | ppg=${dbRow?.ppg} (canonical: ${c.ppg}) | total_pts=${dbRow?.total_points} (canonical: ${c.total_points})`);
  }

  console.log(`\nTotal player_stats rows: ${finalStats.length}`);
  console.log(`Remaining duplicate combos: ${remainingDups}`);
  console.log(`Stats restored on players table: ${statsRestored}`);

  if (remainingDups === 0) {
    console.log('\n✅ ALL PLAYER STATS ARE FULLY REPAIRED!');
  } else {
    console.log(`\n❌ ${remainingDups} duplicate combinations still remain - investigate further`);
  }
}

deepFixPlayerStats().catch(console.error);
