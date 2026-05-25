import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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
    
  const gkSummary = [];

  for (const p of players) {
    const pStats = stats.filter(s => s.player_id === p.id);
    const validMatches = pStats.filter(s => (s.stats.minutes_played ?? 0) >= 45);
    
    if (validMatches.length === 0) continue;
    
    let totalV2Points = 0;
    let totalV2Rating = 0;
    let totalSaves = 0;
    let totalRecoveries = 0;
    let totalCbi = 0;
    let totalCleanSheets = 0;
    let totalGoalsConceded = 0;
    let totalXgc = 0;
    let totalMinutes = 0;
    
    // Count how many matches had exactly 0 saves
    let zeroSaveMatches = 0;
    let zeroSaveCSMatches = 0;
    
    for (const m of validMatches) {
      const s = m.stats;
      totalV2Points += m.fantasy_points_v2 ?? 0;
      totalV2Rating += m.match_rating_v2 ?? 0;
      const sv = s.saves ?? 0;
      totalSaves += sv;
      totalRecoveries += s.fpl_recoveries ?? 0;
      totalCbi += s.fpl_cbi ?? 0;
      const isCS = s.clean_sheet === true;
      totalCleanSheets += isCS ? 1 : 0;
      totalGoalsConceded += s.goals_conceded ?? 0;
      totalXgc += parseFloat(s.expected_goals_conceded ?? 0);
      totalMinutes += s.minutes_played ?? 0;
      
      if (sv === 0) {
        zeroSaveMatches++;
        if (isCS) zeroSaveCSMatches++;
      }
    }
    
    const count = validMatches.length;
    gkSummary.push({
      name: p.name,
      team: p.pl_team,
      matches: count,
      avgV2Points: totalV2Points / count,
      avgV2Rating: totalV2Rating / count,
      avgSaves: totalSaves / count,
      avgRecoveries: totalRecoveries / count,
      avgCbi: totalCbi / count,
      cleanSheets: totalCleanSheets,
      csRate: totalCleanSheets / count,
      avgGc: totalGoalsConceded / count,
      avgXgc: totalXgc / count,
      zeroSaveMatches,
      zeroSaveCSMatches,
    });
  }
  
  gkSummary.sort((a, b) => b.avgV2Points - a.avgV2Points);
  
  console.log('RANKED KEEPERS (ALL):');
  gkSummary.forEach((g, idx) => {
    console.log(`${idx + 1}. ${g.name} (${g.team}): PPG=${g.avgV2Points.toFixed(2)}, Rating=${g.avgV2Rating.toFixed(2)}, Saves=${g.avgSaves.toFixed(2)}, CS=${g.cleanSheets}/${g.matches} (${(g.csRate*100).toFixed(0)}%), 0-Save Games=${g.zeroSaveMatches} (CS: ${g.zeroSaveCSMatches})`);
  });
}

main().catch(console.error);
