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
  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // Query ONLY stats rows where match_rating_v2 is NOT null (which is what is currently backfilled)
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating_v2')
    .eq('player_id', p.id)
    .not('match_rating_v2', 'is', null)
    .order('gameweek', { ascending: true });

  console.log(`Currently backfilled rows for Porro in DB: ${statsRows?.length ?? 0}`);
  
  let playedCount = 0;
  let sumRb = 0;
  let sumRwb = 0;

  for (const r of statsRows || []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    sumRb += Number(r.fantasy_points_v2 ?? 0);
    
    const dynamicRating = calculateMatchRating(s, 'RWB', refStats, p.primary_position);
    sumRwb += dynamicRating.fantasyPoints;
  }

  if (playedCount > 0) {
    console.log(`PPG at RB:  ${(sumRb / playedCount).toFixed(2)}`);
    console.log(`PPG at RWB: ${(sumRwb / playedCount).toFixed(2)}`);
  } else {
    console.log("No played games found in currently backfilled rows.");
  }
})();
