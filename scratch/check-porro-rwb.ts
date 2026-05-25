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

  console.log("=== PEDRO PORRO DETAILED ANALYSIS ===");
  const { data: players } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Pedro Porro%');

  if (!players || players.length === 0) {
    console.log("❌ Pedro Porro not found!");
    return;
  }
  const p = players[0];
  console.log(`Player: ${p.name} | Primary: ${p.primary_position} | Secondaries: ${JSON.stringify(p.secondary_positions)}`);

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2')
    .eq('player_id', p.id)
    .order('gameweek', { ascending: true });

  if (!statsRows || statsRows.length === 0) {
    console.log("❌ No stats rows found!");
    return;
  }

  console.log("\nGW   Mins  DB v1   DB v2   RB(FB)   RWB(WB)   Delta (WB - FB)");
  console.log("-".repeat(70));

  let playedGamesAll = 0;
  let playedGames45 = 0;

  let sumRbAll = 0, sumRwbAll = 0;
  let sumRb45 = 0, sumRwb45 = 0;

  for (const r of statsRows) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    
    playedGamesAll++;
    
    const rb = calculateMatchRating(s, 'RB', refStats, p.primary_position);
    const rwb = calculateMatchRating(s, 'RWB', refStats, p.primary_position);

    sumRbAll += rb.fantasyPoints;
    sumRwbAll += rwb.fantasyPoints;

    const isStarter = s.minutes_played >= 45;
    if (isStarter) {
      playedGames45++;
      sumRb45 += rb.fantasyPoints;
      sumRwb45 += rwb.fantasyPoints;
    }

    console.log(
      `${String(r.gameweek).padStart(2)}   ` +
      `${String(s.minutes_played).padStart(4)}   ` +
      `${Number(r.fantasy_points).toFixed(1).padStart(5)}   ` +
      `${Number(r.fantasy_points_v2).toFixed(1).padStart(5)}   ` +
      `${rb.fantasyPoints.toFixed(1).padStart(6)}   ` +
      `${rwb.fantasyPoints.toFixed(1).padStart(8)}   ` +
      `${(rwb.fantasyPoints - rb.fantasyPoints >= 0 ? '+' : '')}${(rwb.fantasyPoints - rb.fantasyPoints).toFixed(1).padStart(15)}`
    );
  }

  console.log("-".repeat(70));
  console.log(`\nALL PLAYED GAMES (GP: ${playedGamesAll}):`);
  console.log(`  Avg RB  : ${(sumRbAll / playedGamesAll).toFixed(2)}`);
  console.log(`  Avg RWB : ${(sumRwbAll / playedGamesAll).toFixed(2)}`);
  console.log(`  Delta   : ${((sumRwbAll - sumRbAll) / playedGamesAll).toFixed(2)}`);

  console.log(`\nSTARTER GAMES (45+ mins) (GP: ${playedGames45}):`);
  console.log(`  Avg RB  : ${(sumRb45 / playedGames45).toFixed(2)}`);
  console.log(`  Avg RWB : ${(sumRwb45 / playedGames45).toFixed(2)}`);
  console.log(`  Delta   : ${((sumRwb45 - sumRb45) / playedGames45).toFixed(2)}`);
})();
