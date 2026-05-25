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
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS } = await import('../src/lib/scoring/matchRating');
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups');

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // Load all players with DEF primary positions
  const { data: players, error: pError } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .in('primary_position', ['RB', 'LB', 'RWB', 'LWB']);

  if (pError || !players) {
    console.error("Error fetching players:", pError);
    return;
  }

  console.log(`Found ${players.length} players. Analyzing FB vs WB...`);
  console.log("\n%-25s %-12s %-12s %-12s %-8s"
    .replace('%-25s', 'Player'.padEnd(25))
    .replace('%-12s', 'Primary'.padEnd(12))
    .replace('%-12s', 'As FB PPG'.padEnd(12))
    .replace('%-12s', 'As WB PPG'.padEnd(12))
    .replace('%-8s', 'Delta'.padEnd(8))
  );
  console.log("-".repeat(70));

  let betterAtWB = 0;
  let betterAtFB = 0;
  let sameScore = 0;

  for (const p of players) {
    const { data: statsRows } = await sb.from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    const playedGames = statsRows.filter((r: any) => (r.stats as any).minutes_played >= 45);
    if (playedGames.length === 0) continue;

    let fbPts = 0;
    let wbPts = 0;

    for (const r of playedGames) {
      const s = r.stats as any;
      
      // Fullback rating (RB/LB depending on side, let's use RB for right/center or match actual)
      const isLeft = p.primary_position === 'LB' || p.primary_position === 'LWB';
      const fbRole = isLeft ? 'LB' : 'RB';
      const wbRole = isLeft ? 'LWB' : 'RWB';

      fbPts += calculateMatchRating(s, fbRole, refStats, p.primary_position).fantasyPoints;
      wbPts += calculateMatchRating(s, wbRole, refStats, p.primary_position).fantasyPoints;
    }

    const fbPPG = fbPts / playedGames.length;
    const wbPPG = wbPts / playedGames.length;
    const delta = wbPPG - fbPPG;

    if (delta > 0.05) betterAtWB++;
    else if (delta < -0.05) betterAtFB++;
    else sameScore++;

    console.log("%-25s %-12s %-12.2f %-12.2f %-+.2f"
      .replace('%-25s', p.name.slice(0, 24).padEnd(25))
      .replace('%-12s', p.primary_position.padEnd(12))
      .replace('%-12.2f', fbPPG.toFixed(2).padEnd(12))
      .replace('%-12.2f', wbPPG.toFixed(2).padEnd(12))
      .replace('%-+.2f', ((delta >= 0 ? '+' : '') + delta.toFixed(2)).padEnd(8))
    );
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Better at Wingback (> +0.05): ${betterAtWB}`);
  console.log(`Better at Fullback (< -0.05): ${betterAtFB}`);
  console.log(`About the same (within 0.05) : ${sameScore}`);
})();
