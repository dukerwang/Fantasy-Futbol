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
  const { calculateMatchRating } = await import('../src/lib/scoring/matchRating');
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups');

  const { data: players } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Pedro Porro%');

  const p = players![0];
  console.log(`Player: ${p.name} | Primary: ${p.primary_position} | Secondaries: ${JSON.stringify(p.secondary_positions)}`);

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // Query stats rows where match_rating_v2 is not null
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating_v2')
    .eq('player_id', p.id)
    .not('match_rating_v2', 'is', null)
    .order('gameweek', { ascending: true });

  console.log(`Found ${statsRows?.length ?? 0} rows where match_rating_v2 is NOT null.`);
  if (!statsRows || statsRows.length === 0) return;

  let playedCount = 0;
  let sumRb = 0;
  let sumRwb = 0;

  console.log("\nGW   Mins  DB v1   DB v2 (RB)   RWB (Dynamic)");
  console.log("-".repeat(50));
  for (const r of statsRows) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const rb = Number(r.fantasy_points_v2);
    // Dynamically calculate RWB under secondary
    const rwbRating = calculateMatchRating(s, 'RWB', refStats, p.primary_position);
    
    sumRb += rb;
    sumRwb += rwbRating.fantasyPoints;

    console.log(
      `${String(r.gameweek).padStart(2)}   ` +
      `${String(s.minutes_played).padStart(4)}   ` +
      `${Number(r.fantasy_points).toFixed(1).padStart(5)}   ` +
      `${rb.toFixed(1).padStart(10)}   ` +
      `${rwbRating.fantasyPoints.toFixed(1).padStart(13)}`
    );
  }
  console.log("-".repeat(50));
  console.log(`Played Games count: ${playedCount}`);
  console.log(`PPG at RB  (DB v2): ${(sumRb / playedCount).toFixed(2)}`);
  console.log(`PPG at RWB (Dynamic): ${(sumRwb / playedCount).toFixed(2)}`);
})();
