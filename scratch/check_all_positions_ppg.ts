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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team, primary_position');

  if (!players) {
    console.log("No players found!");
    return;
  }

  console.log(`Fetched ${players.length} players. Querying stats in batches...`);

  // Let's query player_stats. Since there are many, we will fetch them in chunks of 500 players to avoid limits or query too much.
  const playerMap = new Map(players.map(p => [p.id, p]));
  const allStats: any[] = [];
  const chunkSize = 200;
  
  for (let i = 0; i < players.length; i += chunkSize) {
    const chunk = players.slice(i, i + chunkSize);
    const ids = chunk.map(p => p.id);
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('player_id, gameweek, stats, fantasy_points, fantasy_points_v2')
      .in('player_id', ids);
    
    if (error) {
      console.error("Error fetching stats chunk:", error);
      continue;
    }
    if (stats) {
      allStats.push(...stats);
    }
  }

  console.log(`Fetched ${allStats.length} total stats rows.`);

  const playerStatsMap = new Map<string, any[]>();
  for (const s of allStats) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id)!.push(s);
  }

  const resultsByPos: Record<string, any[]> = {
    GK: [],
    DF: [],
    MF: [],
    FW: []
  };

  for (const p of players) {
    const stats = playerStatsMap.get(p.id) || [];
    const validMatches = stats.filter(s => (s.stats.minutes_played ?? 0) >= 45);
    if (validMatches.length < 5) continue; // min 5 starts

    const totalV2 = validMatches.reduce((sum, s) => sum + (s.fantasy_points_v2 ?? 0), 0);
    const totalV1 = validMatches.reduce((sum, s) => sum + (s.fantasy_points ?? 0), 0);
    const avgV2 = totalV2 / validMatches.length;
    const avgV1 = totalV1 / validMatches.length;

    const pos = p.primary_position;
    const key = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos) ? 'DF' :
                ['DM', 'CM', 'AM', 'LM', 'RM'].includes(pos) ? 'MF' :
                ['ST', 'LW', 'RW', 'CF'].includes(pos) ? 'FW' : pos;

    if (resultsByPos[key]) {
      resultsByPos[key].push({
        name: p.name,
        team: p.pl_team,
        pos: pos,
        v2Ppg: avgV2,
        v1Ppg: avgV1,
        matches: validMatches.length
      });
    }
  }

  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    console.log(`\n=== TOP 10 ${pos} BY V2 PPG ===`);
    const sorted = resultsByPos[pos].sort((a, b) => b.v2Ppg - a.v2Ppg);
    console.table(sorted.slice(0, 10).map((p, idx) => ({
      Rank: idx + 1,
      Name: p.name,
      Team: p.team,
      Pos: p.pos,
      'V2 PPG': p.v2Ppg.toFixed(2),
      'V1 PPG': p.v1Ppg.toFixed(2),
      Matches: p.matches
    })));
  }
}

main().catch(console.error);
