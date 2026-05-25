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
    .select('id, name, pl_team, primary_position')
    .eq('primary_position', 'GK');

  const playerIds = players.map(p => p.id);
  const { data: stats } = await supabase
    .from('player_stats')
    .select('player_id, gameweek, stats, match_rating, fantasy_points, match_rating_v2, fantasy_points_v2')
    .in('player_id', playerIds);

  const playerMap = new Map(players.map(p => [p.id, p]));

  const gkResults = [];
  const playerStatsMap = new Map();
  for (const s of stats || []) {
    if (!playerStatsMap.has(s.player_id)) {
      playerStatsMap.set(s.player_id, []);
    }
    playerStatsMap.get(s.player_id).push(s);
  }

  for (const [playerId, playerStats] of playerStatsMap.entries()) {
    const p = playerMap.get(playerId);
    const validMatches = playerStats.filter(s => (s.stats.minutes_played ?? 0) >= 45);
    if (validMatches.length === 0) continue;

    let totalOrigPoints = 0;
    let totalV2Points = 0;
    let totalMatches = validMatches.length;

    for (const s of validMatches) {
      totalOrigPoints += s.fantasy_points ?? 0;
      totalV2Points += s.fantasy_points_v2 ?? 0;
    }

    gkResults.push({
      name: p.name,
      team: p.pl_team,
      totalOrigPoints,
      origPpg: totalOrigPoints / totalMatches,
      totalV2Points,
      v2Ppg: totalV2Points / totalMatches,
      matches: totalMatches
    });
  }

  console.log("\n--- GKs Sorted by Total ORIGINAL Fantasy Points ---");
  const sortedByTotalOrig = [...gkResults].sort((a, b) => b.totalOrigPoints - a.totalOrigPoints);
  console.table(sortedByTotalOrig.slice(0, 15).map(g => ({
    Name: g.name,
    Team: g.team,
    'Total Orig Points': g.totalOrigPoints.toFixed(1),
    'Orig PPG': g.origPpg.toFixed(2),
    'Total V2 Points': g.totalV2Points.toFixed(2),
    'V2 PPG': g.v2Ppg.toFixed(2),
    Matches: g.matches
  })));

  console.log("\n--- GKs Sorted by Original PPG (among those with >= 60 total original points) ---");
  const filteredFor60Plus = gkResults.filter(g => g.totalOrigPoints >= 60);
  const sortedByOrigPpg = [...filteredFor60Plus].sort((a, b) => b.origPpg - a.origPpg);
  console.table(sortedByOrigPpg.map(g => ({
    Name: g.name,
    Team: g.team,
    'Total Orig Points': g.totalOrigPoints.toFixed(1),
    'Orig PPG': g.origPpg.toFixed(2),
    'Total V2 Points': g.totalV2Points.toFixed(2),
    'V2 PPG': g.v2Ppg.toFixed(2),
    Matches: g.matches
  })));
}

main().catch(console.error);
