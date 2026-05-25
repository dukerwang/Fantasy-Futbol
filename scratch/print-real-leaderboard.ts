import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { calculateMatchRating } = await import('../src/lib/scoring/matchRating');
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups');

  console.log("Loading all active players...");
  const { data: players } = await sb.from('players').select('id, name, pl_team, primary_position, secondary_positions').eq('is_active', true);
  if (!players) return;
  console.log(`Loaded ${players.length} active players.`);

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // PAGINATE through the ENTIRE player_stats table to get 100% complete stats without truncation
  console.log("Fetching the entire player_stats table (paginated)...");
  const allStats: any[] = [];
  let offset = 0;
  const LIMIT = 1000;
  while (true) {
    const { data, error } = await sb.from('player_stats')
      .select('player_id, gameweek, stats, fantasy_points, fantasy_points_v2')
      .order('id', { ascending: true })
      .range(offset, offset + LIMIT - 1);
    
    if (error) {
      console.error("Error during pagination:", error);
      break;
    }
    if (!data || data.length === 0) break;
    allStats.push(...data);
    if (data.length < LIMIT) break;
    offset += LIMIT;
  }
  console.log(`Successfully fetched ${allStats.length} total stats rows.`);

  // Map stats by player
  const playerStatsMap = new Map<string, any[]>();
  for (const s of allStats) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id)!.push(s);
  }

  const POSITIONS = ['LB', 'RB', 'LWB', 'RWB', 'CM', 'AM'];
  const posLeaders: Record<string, any[]> = {};
  for (const pos of POSITIONS) {
    posLeaders[pos] = [];
  }

  for (const p of players) {
    const statsList = playerStatsMap.get(p.id) || [];
    const played = statsList.filter(s => (s.stats as any)?.minutes_played > 0);
    if (played.length < 5) continue; // min 5 starts

    const primPos = p.primary_position;

    // 1. Primary role
    let sumV1 = 0;
    let sumV2 = 0;
    for (const r of played) {
      sumV1 += Number(r.fantasy_points ?? 0);
      const rating = calculateMatchRating(r.stats as any, primPos as any, refStats, primPos as any);
      sumV2 += rating.fantasyPoints;
    }
    const ppgV1 = sumV1 / played.length;
    const ppgV2 = sumV2 / played.length;

    if (posLeaders[primPos]) {
      posLeaders[primPos].push({
        name: p.name,
        team: p.pl_team,
        ppgV1,
        ppgV2,
        totalV2: sumV2,
        gp: played.length,
        isSecondary: false
      });
    }

    // 2. Secondary roles
    const secondaries = (p.secondary_positions ?? []) as string[];
    for (const secPos of secondaries) {
      if (secPos === primPos) continue;
      let secSumV2 = 0;
      for (const r of played) {
        const rating = calculateMatchRating(r.stats as any, secPos as any, refStats, primPos as any);
        secSumV2 += rating.fantasyPoints;
      }
      const secPpgV2 = secSumV2 / played.length;
      if (posLeaders[secPos]) {
        posLeaders[secPos].push({
          name: p.name,
          team: p.pl_team,
          ppgV1,
          ppgV2: secPpgV2,
          totalV2: secSumV2,
          gp: played.length,
          isSecondary: true,
          rolePath: `${primPos} → ${secPos}`
        });
      }
    }
  }

  console.log("\n==========================================================================================");
  console.log("                        TRUE GAFFA V2 LEADERBOARDS (PAGINATED & CORRECT)                  ");
  console.log("==========================================================================================");

  for (const pos of POSITIONS) {
    console.log(`\n--- POSITION: ${pos} ---`);
    const sorted = posLeaders[pos].sort((a, b) => b.ppgV2 - a.ppgV2).slice(0, 5);
    const tableData = sorted.map((p, idx) => {
      const ppgDisplay = `${p.ppgV2.toFixed(2)} PPG ${p.isSecondary ? `(${p.rolePath})` : ''}`;
      return {
        Rank: idx + 1,
        Name: p.name,
        Team: p.team,
        GP: p.gp,
        'PPG V1': p.ppgV1.toFixed(2),
        'PPG V2': ppgDisplay,
        'Total V2': p.totalV2.toFixed(2)
      };
    });
    console.table(tableData);
  }
})();
