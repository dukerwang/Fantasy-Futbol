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

async function auditStats() {
  console.log('=== AUDITING PLAYER STATS INTEGRITY ===\n');

  // 1. Check Bruno Fernandes on players table
  const brunoCanonical = canonical2025_26.find(p => p.name === 'Bruno Fernandes');
  console.log(`Canonical Bruno Fernandes: total_points=${brunoCanonical?.total_points}, ppg=${brunoCanonical?.ppg}, form_rating=${brunoCanonical?.form_rating}`);

  const { data: brunoDb } = await supabase.from('players').select('*').eq('id', brunoCanonical.id).single();
  console.log(`DB Bruno Fernandes: total_points=${brunoDb?.total_points}, ppg=${brunoDb?.ppg}, form_rating=${brunoDb?.form_rating}, form=${brunoDb?.form}`);

  // 2. Check how many player_stats rows Bruno has
  const { data: brunoStats, count: brunoCount } = await supabase
    .from('player_stats')
    .select('*', { count: 'exact' })
    .eq('player_id', brunoCanonical.id)
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(`\nBruno player_stats row count: ${brunoCount}`);
  if (brunoStats?.length) {
    console.log('Most recent player_stats rows:');
    brunoStats.forEach(r => console.log(`  season=${r.season}, gw=${r.gameweek}, points=${r.points}, rating=${r.rating}`));
  }

  // 3. Check how many player_stats rows overall per player (flag those with unusually high counts)
  const { data: statsCounts } = await supabase
    .from('player_stats')
    .select('player_id')
    .order('player_id');

  const countByPlayer = {};
  statsCounts?.forEach(r => {
    countByPlayer[r.player_id] = (countByPlayer[r.player_id] || 0) + 1;
  });

  const highCounts = Object.entries(countByPlayer)
    .filter(([_, count]) => count > 40)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\nPlayers with > 40 player_stats rows (suspicious duplicates):`);
  for (const [pid, count] of highCounts.slice(0, 20)) {
    const { data: p } = await supabase.from('players').select('name, fpl_id').eq('id', pid).single();
    console.log(`  ${p?.name} (${pid}): ${count} rows`);
  }

  // 4. Check players.ppg mismatches vs canonical
  console.log('\n=== Checking players.ppg vs canonical 2025/26 ===');
  const { data: allDbPlayers } = await supabase.from('players').select('id, name, ppg, total_points, form_rating');
  const canonById = new Map(canonical2025_26.map(p => [p.id, p]));
  let ppgMismatches = 0;
  for (const p of allDbPlayers) {
    const c = canonById.get(p.id);
    if (c && Math.abs((p.ppg || 0) - (c.ppg || 0)) > 0.5) {
      console.log(`  PPG MISMATCH: ${p.name} (${p.id}) - DB ppg=${p.ppg} vs canonical ppg=${c.ppg}`);
      ppgMismatches++;
    }
  }
  console.log(`\nTotal PPG mismatches: ${ppgMismatches}`);
}

auditStats().catch(console.error);
