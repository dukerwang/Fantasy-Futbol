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
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS, POSITION_WEIGHTS } = await import('../src/lib/scoring/matchRating');

  console.log("=== JAMES GARNER PROFILE ===");
  const { data: players, error: pError } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions, ppg, total_points')
    .ilike('name', '%Garner%');
  
  if (pError) {
    console.error("Player fetch error:", pError);
    return;
  }

  if (!players || players.length === 0) {
    console.log("❌ James Garner not found in DB!");
    return;
  }

  const p = players[0];
  console.log(`Player: ${p.name}`);
  console.log(`ID: ${p.id}`);
  console.log(`Primary Position: ${p.primary_position}`);
  console.log(`Secondary Positions: ${JSON.stringify(p.secondary_positions)}`);
  console.log(`DB PPG: ${p.ppg}`);
  console.log(`DB Total Points: ${p.total_points}`);

  // Fetch his player stats
  const { data: statsRows, error: sError } = await sb.from('player_stats')
    .select('id, gameweek, stats, fantasy_points, fantasy_points_v2, match_rating, match_rating_v2')
    .eq('player_id', p.id)
    .order('gameweek', { ascending: true });

  if (sError) {
    console.error("Stats fetch error:", sError);
    return;
  }

  if (!statsRows || statsRows.length === 0) {
    console.log("❌ No stats rows found in player_stats!");
    return;
  }

  // Get rating reference stats to see if they exist in DB
  const { data: refData } = await sb.from('rating_reference_stats').select('*').eq('season', '2025/26');
  const refStats: any = {};
  if (refData?.length) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact:     { median: r.match_impact_median,     stddev: r.match_impact_stddev },
        influence:        { median: r.influence_median,        stddev: r.influence_stddev },
        creativity:       { median: r.creativity_median,       stddev: r.creativity_stddev },
        threat:           { median: r.threat_median,           stddev: r.threat_stddev },
        defensive:        { median: r.defensive_median,        stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        finishing:        { median: r.finishing_median,        stddev: r.finishing_stddev },
        save_score:       { median: r.save_score_median,       stddev: r.save_score_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  console.log("\n=== GAMEWEEK SCORES ===");
  let playedGames = 0;
  let totalCalculatedPoints = 0;

  for (const row of statsRows) {
    const s = row.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedGames++;
    
    // Calculate rating using both DM, CM and RB weights just to compare
    const dmRating = calculateMatchRating(s, 'DM', refStats, 'DM');
    const cmRating = calculateMatchRating(s, 'CM', refStats, 'CM');
    const rbRating = calculateMatchRating(s, 'RB', refStats, 'DM'); // as RB secondary, with primary DM
    
    console.log(`GW${row.gameweek} | Mins: ${s.minutes_played}`);
    console.log(`  DB stored: v1 points: ${row.fantasy_points} | v2 points: ${row.fantasy_points_v2} | match_rating: ${row.match_rating} | match_rating_v2: ${row.match_rating_v2}`);
    console.log(`  Scored as DM: Points = ${dmRating.fantasyPoints.toFixed(2)} | Rating = ${dmRating.rating.toFixed(2)}`);
    console.log(`  Scored as CM: Points = ${cmRating.fantasyPoints.toFixed(2)} | Rating = ${cmRating.rating.toFixed(2)}`);
    console.log(`  Scored as RB: Points = ${rbRating.fantasyPoints.toFixed(2)} | Rating = ${rbRating.rating.toFixed(2)}`);
    
    console.log(`  Raw Stats: BPS=${s.bps}, Infl=${s.influence}, Crea=${s.creativity}, Threat=${s.threat}, DefContrib=${s.fpl_def_contrib}, Tackles=${s.tackles}, Recoveries=${s.recoveries}`);
    
    totalCalculatedPoints += row.fantasy_points_v2 ?? 0;
  }

  console.log(`\nPlayed Games in DB: ${playedGames}`);
  console.log(`Average stored points (all games with mins): ${(totalCalculatedPoints / playedGames).toFixed(2)}`);
})();
