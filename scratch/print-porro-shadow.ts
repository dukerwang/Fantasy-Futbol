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
    .not('match_rating_v2', 'is', null)
    .order('gameweek', { ascending: true });

  // Let's build shadow stats exactly like page.tsx does!
  type ShadowAcc = { gp: number; ptsV1: number; ptsV2: number; sumR1: number; sumR2: number; nR1: number; totalMinutes: number };
  const playerMap = new Map<string, ShadowAcc>();

  const primPos = p.primary_position;
  
  // 1. RB
  const rbAcc: ShadowAcc = { gp: 0, ptsV1: 0, ptsV2: 0, sumR1: 0, sumR2: 0, nR1: 0, totalMinutes: 0 };
  playerMap.set('RB', rbAcc);

  // 2. RWB
  const rwbAcc: ShadowAcc = { gp: 0, ptsV1: 0, ptsV2: 0, sumR1: 0, sumR2: 0, nR1: 0, totalMinutes: 0 };
  playerMap.set('RWB', rwbAcc);

  for (const r of statsRows!) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    const mins = s.minutes_played;

    // RB
    rbAcc.gp += 1;
    rbAcc.ptsV1 += Number(r.fantasy_points ?? 0);
    rbAcc.ptsV2 += Number(r.fantasy_points_v2 ?? 0);

    // RWB
    const dynamicRating = calculateMatchRating(s, 'RWB', refStats, primPos);
    rwbAcc.gp += 1;
    rwbAcc.ptsV1 += Number(r.fantasy_points ?? 0);
    rwbAcc.ptsV2 += dynamicRating.fantasyPoints;
  }

  console.log("=== PEDRO PORRO SHADOW STATS BREAKDOWN ===");
  console.log(`Primary: ${primPos} | Secondaries: ${JSON.stringify(p.secondary_positions)}`);
  console.log(`Played games (N = ${statsRows!.filter(r => (r.stats as any)?.minutes_played > 0).length})`);

  for (const [pos, ex] of playerMap.entries()) {
    console.log(`\nPosition: ${pos}`);
    console.log(`  GP: ${ex.gp}`);
    console.log(`  Pts v1: ${ex.ptsV1.toFixed(2)} | PPG v1: ${(ex.ptsV1 / ex.gp).toFixed(2)}`);
    console.log(`  Pts v2: ${ex.ptsV2.toFixed(2)} | PPG v2: ${(ex.ptsV2 / ex.gp).toFixed(2)}`);
  }
})();
