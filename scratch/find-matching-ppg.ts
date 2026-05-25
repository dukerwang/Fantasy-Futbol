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
    .eq('is_active', true);

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  console.log("Searching for players with RB PPG near 10.3 and RWB PPG near 9.5...");
  
  for (const p of players || []) {
    const { data: statsRows } = await sb.from('player_stats')
      .select('gameweek, stats, fantasy_points_v2, match_rating_v2')
      .eq('player_id', p.id);

    if (!statsRows || statsRows.length === 0) continue;

    let playedCount = 0;
    let sumRb = 0;
    let sumRwb = 0;

    for (const r of statsRows) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedCount++;

      // RB
      const rbRating = calculateMatchRating(s, 'RB', refStats, p.primary_position);
      sumRb += rbRating.fantasyPoints;

      // RWB
      const rwbRating = calculateMatchRating(s, 'RWB', refStats, p.primary_position);
      sumRwb += rwbRating.fantasyPoints;
    }

    if (playedCount > 0) {
      const ppgRb = sumRb / playedCount;
      const ppgRwb = sumRwb / playedCount;
      if (Math.abs(ppgRb - 10.3) < 0.5 && Math.abs(ppgRwb - 9.5) < 0.5) {
        console.log(`Player: ${p.name} | Primary: ${p.primary_position} | GP: ${playedCount} | RB PPG: ${ppgRb.toFixed(2)} | RWB PPG: ${ppgRwb.toFixed(2)}`);
      }
    }
  }
})();
