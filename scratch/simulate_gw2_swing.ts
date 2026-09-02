import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { calculateTeamScore, loadReferenceStats } from '../src/lib/scoring/matchups.ts';
import { normalizeMatchupLineup } from '../src/lib/lineups/normalizeMatchupLineup.ts';
import { applyIctImputation } from '../src/lib/scoring/ictImputation.ts';
import { calculateMatchRating } from '../src/lib/scoring/matchRating.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function run() {
  const refStats = await loadReferenceStats(admin, '2025-26');

  const { data: matchup } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('id', 'b1f0be6c-c9ab-4250-b13b-36623408530b')
    .single();

  const allPlayerIds = [
    ...matchup.lineup_a.starters.map(s => s.player_id),
    ...matchup.lineup_a.bench.map(s => s.player_id),
    ...matchup.lineup_b.starters.map(s => s.player_id),
    ...matchup.lineup_b.bench.map(s => s.player_id),
  ];

  const { data: statsData } = await admin
    .from('player_stats')
    .select('player_id, fantasy_points, stats')
    .eq('season', '2026-27')
    .eq('gameweek', 2)
    .in('player_id', allPlayerIds);

  const { data: playersData } = await admin
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team_id')
    .in('id', allPlayerIds);

  const playerPositions = new Map();
  const playerPlTeamId = new Map();
  const playerMap = new Map();
  for (const p of playersData ?? []) {
    playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
    if (p.pl_team_id) playerPlTeamId.set(p.id, p.pl_team_id);
    playerMap.set(p.id, p);
  }

  // 1. Build FINAL (actual) playerRecord
  const finalPlayerRecord = new Map();
  // 2. Build IMPUTED (live simulated) playerRecord
  const imputedPlayerRecord = new Map();
  // 3. Build ZEROED (if no imputation existed) playerRecord
  const zeroedPlayerRecord = new Map();

  for (const row of statsData ?? []) {
    const actualStats = row.stats ?? null;
    const p = playerMap.get(row.player_id);
    const fixtureMins = actualStats?.minutes_played ?? 0;
    
    // Final
    const finalV2 = actualStats && fixtureMins > 0 ? calculateMatchRating(actualStats, p.primary_position, refStats) : { fantasyPoints: 0 };
    finalPlayerRecord.set(row.player_id, {
      fixtures: [{ minutes: fixtureMins, fantasyPoints: finalV2.fantasyPoints, stats: actualStats }]
    });

    // Imputed
    const imputedStats = actualStats && fixtureMins > 0 ? applyIctImputation({ ...actualStats }, p.primary_position) : null;
    const imputedV2 = imputedStats && fixtureMins > 0 ? calculateMatchRating(imputedStats, p.primary_position, refStats) : { fantasyPoints: 0 };
    imputedPlayerRecord.set(row.player_id, {
      fixtures: [{ minutes: fixtureMins, fantasyPoints: imputedV2.fantasyPoints, stats: imputedStats }]
    });

    // Zeroed
    const zeroedStats = actualStats && fixtureMins > 0 ? { ...actualStats, influence: 0, creativity: 0, threat: 0, ict_index: 0 } : null;
    const zeroedV2 = zeroedStats && fixtureMins > 0 ? calculateMatchRating(zeroedStats, p.primary_position, refStats) : { fantasyPoints: 0 };
    zeroedPlayerRecord.set(row.player_id, {
      fixtures: [{ minutes: fixtureMins, fantasyPoints: zeroedV2.fantasyPoints, stats: zeroedStats }]
    });
  }

  const detailFinalA = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailFinalB = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailImpA = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailImpB = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailZeroA = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailZeroB = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };

  const scoreFinalA = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_a), finalPlayerRecord, playerPositions, playerPlTeamId, refStats, true, new Set(), detailFinalA);
  const scoreFinalB = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_b), finalPlayerRecord, playerPositions, playerPlTeamId, refStats, true, new Set(), detailFinalB);

  const scoreImpA = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_a), imputedPlayerRecord, playerPositions, playerPlTeamId, refStats, false, new Set(), detailImpA);
  const scoreImpB = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_b), imputedPlayerRecord, playerPositions, playerPlTeamId, refStats, false, new Set(), detailImpB);

  const scoreZeroA = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_a), zeroedPlayerRecord, playerPositions, playerPlTeamId, refStats, false, new Set(), detailZeroA);
  const scoreZeroB = calculateTeamScore(normalizeMatchupLineup(matchup.lineup_b), zeroedPlayerRecord, playerPositions, playerPlTeamId, refStats, false, new Set(), detailZeroB);

  console.log('========================================================================');
  console.log('GW2 MATCHUP COMPARISON: Hayden FC vs Not Too Xabi');
  console.log('========================================================================');
  console.log(`1. LIVE IMPUTED:     Hayden FC ${scoreImpA.toFixed(2)} - ${scoreImpB.toFixed(2)} Not Too Xabi (Margin: ${(scoreImpA - scoreImpB).toFixed(2)})`);
  console.log(`2. FINAL ACTUAL:     Hayden FC ${scoreFinalA.toFixed(2)} - ${scoreFinalB.toFixed(2)} Not Too Xabi (Margin: ${(scoreFinalB - scoreFinalA).toFixed(2)} Not Too Xabi win)`);
  console.log(`3. ZEROED (No Imp):  Hayden FC ${scoreZeroA.toFixed(2)} - ${scoreZeroB.toFixed(2)} Not Too Xabi`);
  console.log(`\nNet Swing: ${((scoreFinalB - scoreImpB) - (scoreFinalA - scoreImpA)).toFixed(2)} points in favor of Not Too Xabi`);
  console.log(`  Hayden FC Δ:   ${(scoreFinalA - scoreImpA).toFixed(2)} pts`);
  console.log(`  Not Too Xabi Δ: ${(scoreFinalB - scoreImpB).toFixed(2)} pts`);

  function printTeamTable(teamName, lineup, recImp, recFinal) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`TEAM: ${teamName}`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`Slot | Player | Pos | Min | Live (Imp) | Final (Act) | Δ Pts | Key Factors (ICT actual vs imputed)`);
    console.log(`-----|--------|-----|-----|------------|-------------|-------|-----------------------------------`);
    
    for (const s of lineup.starters) {
      const p = playerMap.get(s.player_id);
      const impFix = recImp.get(s.player_id)?.fixtures[0];
      const finFix = recFinal.get(s.player_id)?.fixtures[0];
      
      const impRes = impFix?.stats ? calculateMatchRating(impFix.stats, s.slot, refStats, p.primary_position) : { fantasyPoints: 0, rating: 0 };
      const finRes = finFix?.stats ? calculateMatchRating(finFix.stats, s.slot, refStats, p.primary_position) : { fantasyPoints: 0, rating: 0 };
      
      const d = finRes.fantasyPoints - impRes.fantasyPoints;
      const actual = finFix?.stats || {};
      const imputed = impFix?.stats || {};
      
      const factor = `Inf ${actual.influence?.toFixed(1) || 0} vs ${imputed.influence?.toFixed(1) || 0} (Δ ${(actual.influence - imputed.influence).toFixed(1)}), Cre ${actual.creativity?.toFixed(1) || 0} vs ${imputed.creativity?.toFixed(1) || 0} (Δ ${(actual.creativity - imputed.creativity).toFixed(1)}), Thr ${actual.threat?.toFixed(1) || 0} vs ${imputed.threat?.toFixed(1) || 0} (Δ ${(actual.threat - imputed.threat).toFixed(1)})`;
      
      console.log(`${s.slot.padEnd(4)} | ${(p.web_name || p.name).padEnd(12)} | ${p.primary_position.padEnd(3)} | ${String(actual.minutes_played || 0).padEnd(3)} | ${impRes.fantasyPoints.toFixed(2).padStart(10)} | ${finRes.fantasyPoints.toFixed(2).padStart(11)} | ${(d >= 0 ? '+' : '') + d.toFixed(2).padStart(5)} | ${factor}`);
    }

    console.log(`\nBench Bonus:`);
    for (const b of lineup.bench) {
      const p = playerMap.get(b.player_id);
      const impFix = recImp.get(b.player_id)?.fixtures[0];
      const finFix = recFinal.get(b.player_id)?.fixtures[0];
      const impPts = (impFix?.fantasyPoints || 0) * 0.25;
      const finPts = (finFix?.fantasyPoints || 0) * 0.25;
      const d = finPts - impPts;
      console.log(`  ${b.slot}: ${p.web_name} -> Live ${impPts.toFixed(2)} | Final ${finPts.toFixed(2)} (Δ ${(d >= 0 ? '+' : '') + d.toFixed(2)})`);
    }
  }

  printTeamTable('Hayden FC', matchup.lineup_a, imputedPlayerRecord, finalPlayerRecord);
  printTeamTable('Not Too Xabi', matchup.lineup_b, imputedPlayerRecord, finalPlayerRecord);
}

run().catch(console.error);
