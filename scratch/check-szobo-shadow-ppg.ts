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
    .ilike('name', '%Szoboszlai%');

  const p = players![0];
  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // Query stats rows
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating_v2')
    .eq('player_id', p.id)
    .not('match_rating_v2', 'is', null)
    .order('gameweek', { ascending: true });

  console.log(`=== Dominik Szoboszlai Shadow Leaderboard Simulation ===`);
  console.log(`GP: ${statsRows?.length ?? 0}`);

  // Test AM
  let sumAmPts = 0;
  for (const r of statsRows || []) {
    sumAmPts += Number(r.fantasy_points_v2 ?? 0);
  }
  console.log(`AM (Primary) V2 PPG: ${(sumAmPts / statsRows!.length).toFixed(2)}`);

  // Test CM (Secondary)
  let sumCmPts = 0;
  for (const r of statsRows || []) {
    const s = r.stats as any;
    const calc = calculateMatchRating(s, 'CM', refStats, p.primary_position);
    sumCmPts += calc.fantasyPoints;
  }
  console.log(`CM (Secondary) V2 PPG: ${(sumCmPts / statsRows!.length).toFixed(2)}`);

  // Test RB (Secondary)
  let sumRbPts = 0;
  for (const r of statsRows || []) {
    const s = r.stats as any;
    const calc = calculateMatchRating(s, 'RB', refStats, p.primary_position);
    sumRbPts += calc.fantasyPoints;
  }
  console.log(`RB (Secondary) V2 PPG: ${(sumRbPts / statsRows!.length).toFixed(2)}`);
})();
