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
  console.log('Fetching GK stats from Supabase...');
  
  // 1. Fetch players who are GKs
  const { data: players, error: pError } = await supabase
    .from('players')
    .select('id, name, pl_team, primary_position')
    .eq('primary_position', 'GK');
    
  if (pError) {
    console.error('Error fetching GKs:', pError);
    return;
  }
  
  console.log(`Found ${players.length} Goalkeepers in DB.`);
  
  // 2. Fetch all stats for GKs
  const playerIds = players.map(p => p.id);
  const { data: stats, error: sError } = await supabase
    .from('player_stats')
    .select('player_id, gameweek, stats, match_rating_v2, fantasy_points_v2')
    .in('player_id', playerIds);
    
  if (sError) {
    console.error('Error fetching stats:', sError);
    return;
  }
  
  console.log(`Found ${stats.length} player stats rows for GKs.`);

  // 3. Process data
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
    
    for (const m of validMatches) {
      const s = m.stats;
      totalV2Points += m.fantasy_points_v2 ?? 0;
      totalV2Rating += m.match_rating_v2 ?? 0;
      totalSaves += s.saves ?? 0;
      totalRecoveries += s.fpl_recoveries ?? 0;
      totalCbi += s.fpl_cbi ?? 0;
      totalCleanSheets += s.clean_sheet === true ? 1 : 0;
      totalGoalsConceded += s.goals_conceded ?? 0;
      totalXgc += parseFloat(s.expected_goals_conceded ?? 0);
      totalMinutes += s.minutes_played ?? 0;
    }
    
    const count = validMatches.length;
    gkSummary.push({
      id: p.id,
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
      avgMinutes: totalMinutes / count,
    });
  }
  
  // Sort by average V2 fantasy points descending
  gkSummary.sort((a, b) => b.avgV2Points - a.avgV2Points);
  
  console.log('\n--- TOP GOALKEEPERS BY AVERAGE V2 POINTS PER GAME (PPG) ---');
  
  // Format table nicely and avoid console.table truncation
  const formattedSummary = gkSummary.slice(0, 20).map((g, idx) => ({
    Rank: idx + 1,
    Name: g.name,
    Team: g.team,
    Matches: g.matches,
    'V2 PPG': g.avgV2Points.toFixed(2),
    'V2 Avg Rating': g.avgV2Rating.toFixed(2),
    'Avg Saves': g.avgSaves.toFixed(2),
    'Avg Recoveries': g.avgRecoveries.toFixed(2),
    'CS Count': g.cleanSheets,
    'CS Rate': (g.csRate * 100).toFixed(0) + '%',
    'Avg GC': g.avgGc.toFixed(2),
    'Avg xGC': g.avgXgc.toFixed(2)
  }));
  console.log(JSON.stringify(formattedSummary, null, 2));
  
  // Look specifically for Raya and Donnarumma, and Roefs and Hermansen
  const targetNames = ['David Raya', 'Gianluigi Donnarumma', 'Robin Roefs', 'Mads Hermansen'];
  console.log('\n--- DIAGNOSING TARGET KEEPERS ---');
  for (const name of targetNames) {
    const match = gkSummary.find(g => g.name.toLowerCase().includes(name.toLowerCase()));
    if (match) {
      console.log(`\n=== ${match.name} (${match.team}) ===`);
      console.log(`Matches >=45 mins: ${match.matches}`);
      console.log(`V2 PPG:            ${match.avgV2Points.toFixed(2)}`);
      console.log(`V2 Avg Rating:     ${match.avgV2Rating.toFixed(2)}`);
      console.log(`Avg Saves/game:    ${match.avgSaves.toFixed(2)}`);
      console.log(`Avg Rec/game:      ${match.avgRecoveries.toFixed(2)}`);
      console.log(`Avg CBI/game:      ${match.avgCbi.toFixed(2)}`);
      console.log(`Clean Sheets:      ${match.cleanSheets} (${(match.csRate * 100).toFixed(1)}%)`);
      console.log(`Avg GC/game:       ${match.avgGc.toFixed(2)}`);
      console.log(`Avg xGC/game:      ${match.avgXgc.toFixed(2)}`);
      
      // Let's print games for this goalkeeper
      const pStats = stats.filter(s => s.player_id === match.id);
      const validMatches = pStats.filter(s => (s.stats.minutes_played ?? 0) >= 45);
      
      // Sort validMatches by gameweek
      validMatches.sort((a, b) => a.gameweek - b.gameweek);
      
      console.log(`\nGame-by-game breakdown (first 10 matches):`);
      const formattedGames = validMatches.slice(0, 15).map(m => ({
        GW: m.gameweek,
        Saves: m.stats.saves ?? 0,
        CS: m.stats.clean_sheet === true ? 'YES' : 'NO',
        Rec: m.stats.fpl_recoveries ?? 0,
        CBI: m.stats.fpl_cbi ?? 0,
        GC: m.stats.goals_conceded ?? 0,
        xGC: parseFloat(m.stats.expected_goals_conceded ?? 0).toFixed(2),
        'Rating V2': m.match_rating_v2,
        'Points V2': m.fantasy_points_v2,
      }));
      console.log(JSON.stringify(formattedGames, null, 2));
    } else {
      console.log(`Keeper "${name}" not found in summary.`);
    }
  }
}

main().catch(console.error);
