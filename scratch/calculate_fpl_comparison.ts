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
    .select('player_id, gameweek, stats, fantasy_points, fantasy_points_v2, match_rating, match_rating_v2')
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
    // Filter out matches where minutes_played < 45 (or let's include all matches where they played > 0)
    const validMatches = playerStats.filter(s => (s.stats.minutes_played ?? 0) > 0);
    if (validMatches.length === 0) continue;

    let totalV1Points = 0;
    let totalV2Points = 0;
    let totalFplPoints = 0;
    let cleanSheets = 0;
    let totalSaves = 0;
    let totalMins = 0;
    let matchesWith60Plus = 0;

    for (const s of validMatches) {
      const st = s.stats;
      totalV1Points += s.fantasy_points ?? 0;
      totalV2Points += s.fantasy_points_v2 ?? 0;

      // Calculate standard FPL points:
      let fplPt = 0;
      const mins = st.minutes_played ?? 0;
      totalMins += mins;
      
      if (mins > 0) {
        if (mins >= 60) {
          fplPt += 2;
          matchesWith60Plus++;
        } else {
          fplPt += 1;
        }
      }

      if (st.clean_sheet === true && mins >= 60) {
        fplPt += 4;
        cleanSheets++;
      }

      const saves = st.saves ?? 0;
      totalSaves += saves;
      fplPt += Math.floor(saves / 3);

      const psav = st.penalty_saves ?? 0;
      fplPt += psav * 5;

      const pmis = st.penalties_missed ?? 0;
      fplPt -= pmis * 2;

      const gc = st.goals_conceded ?? 0;
      fplPt -= Math.floor(gc / 2);

      const og = st.own_goals ?? 0;
      fplPt -= og * 2;

      const yc = st.yellow_cards ?? 0;
      fplPt -= yc;

      const rc = st.red_cards ?? 0;
      fplPt -= rc * 3;

      const gls = st.goals ?? 0;
      fplPt += gls * 6;

      const ast = st.assists ?? 0;
      fplPt += ast * 3;

      totalFplPoints += fplPt;
    }

    const matchesCount = validMatches.length;

    gkResults.push({
      name: p.name,
      team: p.pl_team,
      totalV1Points,
      v1Ppg: totalV1Points / matchesCount,
      totalV2Points,
      v2Ppg: totalV2Points / matchesCount,
      totalFplPoints,
      fplPpg: totalFplPoints / matchesCount,
      cleanSheets,
      avgSaves: totalSaves / matchesCount,
      matches: matchesCount
    });
  }

  console.log("\n=== GKs SORTED BY TOTAL FPL POINTS (Calculated from raw stats) ===");
  const sortedByTotalFpl = [...gkResults].sort((a, b) => b.totalFplPoints - a.totalFplPoints);
  console.table(sortedByTotalFpl.map((g, idx) => ({
    Rank: idx + 1,
    Name: g.name,
    Team: g.team,
    'FPL Total': g.totalFplPoints,
    'FPL PPG': g.fplPpg.toFixed(2),
    'V1 Total': g.totalV1Points.toFixed(1),
    'V1 PPG': g.v1Ppg.toFixed(2),
    'V2 Total': g.totalV2Points.toFixed(1),
    'V2 PPG': g.v2Ppg.toFixed(2),
    CS: g.cleanSheets,
    'Avg Saves': g.avgSaves.toFixed(2),
    Matches: g.matches
  })));
}

main().catch(console.error);
