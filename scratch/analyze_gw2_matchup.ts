import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating.ts';
import { applyIctImputation } from '../src/lib/scoring/ictImputation.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Load reference stats from DB if available
const { data: dbRefStats } = await admin
  .from('rating_reference_stats')
  .select('*')
  .eq('season', '2026-27');

const refStats = { ...DEFAULT_REFERENCE_STATS };
if (dbRefStats && dbRefStats.length > 0) {
  for (const r of dbRefStats) {
    if (r.position) {
      refStats[r.position] = {
        match_impact: { median: Number(r.match_impact_median), stddev: Number(r.match_impact_stddev) },
        influence: { median: Number(r.influence_median), stddev: Number(r.influence_stddev) },
        creativity: { median: Number(r.creativity_median), stddev: Number(r.creativity_stddev) },
        threat: { median: Number(r.threat_median), stddev: Number(r.threat_stddev) },
        defensive: { median: Number(r.defensive_median), stddev: Number(r.defensive_stddev) },
        goal_involvement: { median: Number(r.goal_involvement_median), stddev: Number(r.goal_involvement_stddev) },
        finishing: { median: Number(r.finishing_median), stddev: Number(r.finishing_stddev) },
        save_score: { median: Number(r.save_score_median), stddev: Number(r.save_score_stddev) },
      };
    }
  }
}

async function analyzeMatchup() {
  const { data: matchup } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('id', 'b1f0be6c-c9ab-4250-b13b-36623408530b')
    .single();

  const starterAIds = matchup.lineup_a.starters.map((s) => s.player_id);
  const starterBIds = matchup.lineup_b.starters.map((s) => s.player_id);
  const allStarterIds = [...starterAIds, ...starterBIds];

  const { data: players } = await admin
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team')
    .in('id', allStarterIds);

  const playerMap = new Map(players.map((p) => [p.id, p]));

  const { data: statsGW2 } = await admin
    .from('player_stats')
    .select('*')
    .eq('gameweek', 2)
    .in('player_id', allStarterIds);

  const statsMap = new Map(statsGW2.map((s) => [s.player_id, s]));

  function evaluateTeam(teamName, starters) {
    console.log(`\n================== ${teamName} ==================`);
    let totalImputedPts = 0;
    let totalFinalPts = 0;
    
    for (const s of starters) {
      const p = playerMap.get(s.player_id);
      const row = statsMap.get(s.player_id);
      const stats = row?.stats || {};
      
      const pos = s.slot; // slot position used in matchup
      const primaryPos = p?.primary_position;

      // Actual final result
      const finalRating = calculateMatchRating(stats, pos, refStats, primaryPos);
      
      // Imputed stats (as would have been calculated live before ICT came in)
      const imputedStats = applyIctImputation({ ...stats }, primaryPos);
      const imputedRating = calculateMatchRating(imputedStats, pos, refStats, primaryPos);

      // What if ICT was zeroed (purely 0.0)?
      const zeroStats = { ...stats, influence: 0, creativity: 0, threat: 0, ict_index: 0 };
      const zeroRating = calculateMatchRating(zeroStats, pos, refStats, primaryPos);

      const deltaPts = finalRating.fantasyPoints - imputedRating.fantasyPoints;
      totalImputedPts += imputedRating.fantasyPoints;
      totalFinalPts += finalRating.fantasyPoints;

      console.log(`\n[${s.slot}] ${p?.web_name || p?.name} (${primaryPos}, ${p?.pl_team}) - Min: ${stats.minutes_played}`);
      console.log(`  Actual Stats:  BPS=${stats.bps}, Inf=${stats.influence}, Cre=${stats.creativity}, Thr=${stats.threat}, G=${stats.goals}, A=${stats.assists}, CS=${stats.clean_sheet}, GC=${stats.goals_conceded}`);
      console.log(`  Imputed Stats: Inf=${imputedStats.influence}, Cre=${imputedStats.creativity}, Thr=${imputedStats.threat}`);
      console.log(`  Imputed: Rating ${imputedRating.rating.toFixed(2)} -> Pts ${imputedRating.fantasyPoints.toFixed(2)}`);
      console.log(`  Final:   Rating ${finalRating.rating.toFixed(2)} -> Pts ${finalRating.fantasyPoints.toFixed(2)}`);
      console.log(`  Zeroed:  Rating ${zeroRating.rating.toFixed(2)} -> Pts ${zeroRating.fantasyPoints.toFixed(2)}`);
      console.log(`  Δ (Final - Imputed): ${deltaPts >= 0 ? '+' : ''}${deltaPts.toFixed(2)} pts (Rating Δ: ${(finalRating.rating - imputedRating.rating).toFixed(2)})`);
    }

    console.log(`\n>>> TOTAL ${teamName}: Imputed = ${totalImputedPts.toFixed(2)} | Final = ${totalFinalPts.toFixed(2)} | Net Δ = ${(totalFinalPts - totalImputedPts).toFixed(2)}`);
    return { totalImputedPts, totalFinalPts };
  }

  const teamA = evaluateTeam(matchup.team_a.team_name, matchup.lineup_a.starters);
  const teamB = evaluateTeam(matchup.team_b.team_name, matchup.lineup_b.starters);

  console.log('\n================== SUMMARY ==================');
  console.log(`${matchup.team_a.team_name}: Imputed ${teamA.totalImputedPts.toFixed(2)} -> Final ${teamA.totalFinalPts.toFixed(2)} (Δ ${(teamA.totalFinalPts - teamA.totalImputedPts).toFixed(2)})`);
  console.log(`${matchup.team_b.team_name}: Imputed ${teamB.totalImputedPts.toFixed(2)} -> Final ${teamB.totalFinalPts.toFixed(2)} (Δ ${(teamB.totalFinalPts - teamB.totalImputedPts).toFixed(2)})`);
  console.log(`Net Swing: ${(teamB.totalFinalPts - teamB.totalImputedPts) - (teamA.totalFinalPts - teamA.totalImputedPts)} pts in favor of ${matchup.team_b.team_name}`);
}

analyzeMatchup().catch(console.error);
