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
    .select('player_id, gameweek, stats, match_rating_v2, fantasy_points_v2')
    .in('player_id', playerIds);

  const playerMap = new Map(players.map(p => [p.id, p]));

  // Let's print out the structure of a single stat
  if (stats && stats.length > 0) {
    console.log("Stats keys in stats.stats object:", Object.keys(stats[0].stats));
    console.log("Sample stat object:", JSON.stringify(stats[0].stats, null, 2));
  }

  // Let's calculate standard FPL points and PPG for each GK
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

    let totalFplPoints = 0;
    let totalV2Points = 0;
    let totalMatches = validMatches.length;

    for (const s of validMatches) {
      // Standard FPL points can be computed or found. Let's see if total_points is in stats.stats
      // FPL scoring rules for GK:
      // - Minutes played: 1 pt for <60, 2 pts for >=60
      // - Clean sheet: 4 pts (if >=60 mins)
      // - Saves: 1 pt per 3 saves
      // - Penalty saves: 5 pts
      // - Penalty missed: -2 pts
      // - Goals conceded: -1 pt per 2 goals conceded
      // - Yellow card: -1 pt
      // - Red card: -3 pts
      // - Own goals: -2 pts
      // - Goals scored: 10 pts (FPL GK gets 10 pts in some variations, or 6 pts in standard. Let's assume standard FPL is 6 pts)
      // - Assists: 3 pts
      // - Bonus points (BPS based): 1, 2, or 3 pts. Let's see if stats.stats has bonus or total_points or if we can calculate it.
      
      const st = s.stats;
      let fplPt = st.total_points ?? 0; // standard FPL total_points is often stored
      if (fplPt === 0) {
        // Let's fallback to manual FPL calculation or see if it's there
        // Actually, FPL bootstrap-static might have had it, let's see.
      }
      totalFplPoints += fplPt;
      totalV2Points += s.fantasy_points_v2 ?? 0;
    }

    gkResults.push({
      name: p.name,
      team: p.pl_team,
      totalFplPoints,
      fplPpg: totalFplPoints / totalMatches,
      totalV2Points,
      v2Ppg: totalV2Points / totalMatches,
      matches: totalMatches
    });
  }

  console.log("\n--- GKs Sorted by Total FPL Points (total_points in database) ---");
  const sortedByTotalFpl = [...gkResults].sort((a, b) => b.totalFplPoints - a.totalFplPoints);
  console.table(sortedByTotalFpl.slice(0, 15).map(g => ({
    Name: g.name,
    Team: g.team,
    'Total FPL Points': g.totalFplPoints,
    'FPL PPG': g.fplPpg.toFixed(2),
    'Total V2 Points': g.totalV2Points.toFixed(2),
    'V2 PPG': g.v2Ppg.toFixed(2),
    Matches: g.matches
  })));

  console.log("\n--- GKs Sorted by FPL PPG (among those with >= 60 total FPL Points) ---");
  const filteredFor60Plus = gkResults.filter(g => g.totalFplPoints >= 60);
  const sortedByFplPpg = [...filteredFor60Plus].sort((a, b) => b.fplPpg - a.fplPpg);
  console.table(sortedByFplPpg.map(g => ({
    Name: g.name,
    Team: g.team,
    'Total FPL Points': g.totalFplPoints,
    'FPL PPG': g.fplPpg.toFixed(2),
    'Total V2 Points': g.totalV2Points.toFixed(2),
    'V2 PPG': g.v2Ppg.toFixed(2),
    Matches: g.matches
  })));
}

main().catch(console.error);
