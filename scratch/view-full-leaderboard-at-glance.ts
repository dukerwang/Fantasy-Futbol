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

  const { data: players } = await sb.from('players').select('id, name, pl_team, primary_position, secondary_positions').eq('is_active', true);
  if (!players) {
    console.log("No active players found!");
    return;
  }

  const refStats = await loadReferenceStats(sb as any, '2025-26');

  // Query stats chunk by chunk
  const playerStatsMap = new Map<string, any[]>();
  const chunkSize = 200;
  for (let i = 0; i < players.length; i += chunkSize) {
    const chunk = players.slice(i, i + chunkSize);
    const ids = chunk.map(p => p.id);
    const { data: stats } = await sb.from('player_stats')
      .select('player_id, gameweek, stats, fantasy_points, fantasy_points_v2')
      .in('player_id', ids);
    if (stats) {
      for (const s of stats) {
        if (!playerStatsMap.has(s.player_id)) {
          playerStatsMap.set(s.player_id, []);
        }
        playerStatsMap.get(s.player_id)!.push(s);
      }
    }
  }

  const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
  const posLeaders: Record<string, any[]> = {};
  for (const pos of POSITIONS) {
    posLeaders[pos] = [];
  }

  for (const p of players) {
    const statsList = playerStatsMap.get(p.id) || [];
    const played = statsList.filter(s => (s.stats as any)?.minutes_played > 0);
    if (played.length < 5) continue; // min 5 appearances

    // Evaluate for primary position
    const primPos = p.primary_position;
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

    // Evaluate for secondary positions
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

  // Print top 5 for each granular position
  console.log("==========================================================================================");
  console.log("                        GAFFA V2 GRANULAR POSITION LEADERS AT A GLANCE                    ");
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
