import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS, getPositionGroup } = await import('../src/lib/scoring/matchRating');

  // FIXED loadReferenceStats
  async function loadReferenceStatsFixed(admin: any, season: string) {
    const { data, error } = await admin
      .from('rating_reference_stats')
      .select('position_group, component, median, stddev')
      .eq('season', season);

    if (error || !data || data.length === 0) {
      console.log("Failed to load reference stats from DB or empty. Using default.");
      return DEFAULT_REFERENCE_STATS;
    }

    const ref = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
    
    // Position groups list
    const granularPositions = Object.keys(DEFAULT_REFERENCE_STATS);

    for (const row of data) {
      const group = row.position_group;
      const comp = row.component;

      // Find all granular positions belonging to this group
      for (const pos of granularPositions) {
        if (getPositionGroup(pos as any) === group) {
          if (ref[pos] && ref[pos][comp]) {
            ref[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
          }
        }
      }
    }
    return ref;
  }

  const { data: players } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Pedro Porro%');

  const p = players![0];
  const refStatsDefault = DEFAULT_REFERENCE_STATS;
  const refStatsFixed = await loadReferenceStatsFixed(sb, '2025-26');

  // Query stats rows
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2')
    .eq('player_id', p.id)
    .order('gameweek', { ascending: true });

  let playedCount = 0;
  let sumRbDef = 0;
  let sumRwbDef = 0;
  let sumRbFix = 0;
  let sumRwbFix = 0;

  for (const r of statsRows!) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const rbDef = calculateMatchRating(s, 'RB', refStatsDefault, p.primary_position).fantasyPoints;
    const rwbDef = calculateMatchRating(s, 'RWB', refStatsDefault, p.primary_position).fantasyPoints;

    const rbFix = calculateMatchRating(s, 'RB', refStatsFixed, p.primary_position).fantasyPoints;
    const rwbFix = calculateMatchRating(s, 'RWB', refStatsFixed, p.primary_position).fantasyPoints;

    sumRbDef += rbDef;
    sumRwbDef += rwbDef;
    sumRbFix += rbFix;
    sumRwbFix += rwbFix;
  }

  console.log(`Played Games: ${playedCount}`);
  console.log("Using DEFAULT_REFERENCE_STATS (what currently runs due to bug):");
  console.log(`  PPG at RB : ${(sumRbDef / playedCount).toFixed(2)}`);
  console.log(`  PPG at RWB: ${(sumRwbDef / playedCount).toFixed(2)}`);

  console.log("\nUsing FIXED_REFERENCE_STATS (after loading DB values correctly):");
  console.log(`  PPG at RB : ${(sumRbFix / playedCount).toFixed(2)}`);
  console.log(`  PPG at RWB: ${(sumRwbFix / playedCount).toFixed(2)}`);
})();
