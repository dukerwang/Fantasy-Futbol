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

  // Query ALL stats rows for Porro
  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating_v2')
    .eq('player_id', p.id)
    .order('gameweek', { ascending: true });

  console.log("Checking gameweek ranges to find 10.3 ppg at RB and 9.5 ppg at RWB:\n");

  for (let maxGw = 1; maxGw <= 38; maxGw++) {
    const filteredRows = statsRows!.filter(r => r.gameweek <= maxGw);
    let playedCount = 0;
    let sumRb = 0;
    let sumRwb = 0;

    for (const r of filteredRows) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedCount++;

      // RB score is DB's fantasy_points_v2 if match_rating_v2 is not null, otherwise dynamic
      let rb = r.fantasy_points_v2 != null ? Number(r.fantasy_points_v2) : calculateMatchRating(s, 'RB', refStats, p.primary_position).fantasyPoints;
      let rwb = calculateMatchRating(s, 'RWB', refStats, p.primary_position).fantasyPoints;

      sumRb += rb;
      sumRwb += rwb;
    }

    if (playedCount > 0) {
      const ppgRb = sumRb / playedCount;
      const ppgRwb = sumRwb / playedCount;
      if (Math.abs(ppgRb - 10.3) < 0.2 || Math.abs(ppgRwb - 9.5) < 0.2) {
        console.log(`GW 1 to ${maxGw} (GP: ${playedCount}): RB PPG = ${ppgRb.toFixed(2)}, RWB PPG = ${ppgRwb.toFixed(2)}`);
      }
    }
  }
})();
