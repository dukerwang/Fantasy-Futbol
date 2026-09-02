import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { calculateTeamScore, loadReferenceStats } from '../src/lib/scoring/matchups.ts';
import { normalizeMatchupLineup } from '../src/lib/lineups/normalizeMatchupLineup.ts';

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
  const { data: matchup } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('id', 'b1f0be6c-c9ab-4250-b13b-36623408530b')
    .single();

  const refStats = await loadReferenceStats(admin, '2025-26');

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

  const playerRecord = new Map();
  for (const row of statsData ?? []) {
    const stats = row.stats ?? null;
    const fixtureMins = stats?.minutes_played ?? 0;
    const pts = Number(row.fantasy_points) || 0;
    const fix = { minutes: fixtureMins, fantasyPoints: pts, stats };
    const existing = playerRecord.get(row.player_id);
    if (!existing) playerRecord.set(row.player_id, { fixtures: [fix] });
    else existing.fixtures.push(fix);
  }

  const { data: playersData } = await admin
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team_id')
    .in('id', allPlayerIds);

  const playerPositions = new Map();
  const playerPlTeamId = new Map();
  for (const p of playersData ?? []) {
    playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
    if (p.pl_team_id) playerPlTeamId.set(p.id, p.pl_team_id);
  }

  const detailA = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
  const detailB = { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };

  const scoreA = calculateTeamScore(
    normalizeMatchupLineup(matchup.lineup_a),
    playerRecord,
    playerPositions,
    playerPlTeamId,
    refStats,
    true,
    new Set(),
    detailA
  );

  const scoreB = calculateTeamScore(
    normalizeMatchupLineup(matchup.lineup_b),
    playerRecord,
    playerPositions,
    playerPlTeamId,
    refStats,
    true,
    new Set(),
    detailB
  );

  console.log('calculateTeamScore Team A (Hayden FC):', scoreA, 'Stored score_a:', matchup.score_a);
  console.log('calculateTeamScore Team B (Not Too Xabi):', scoreB, 'Stored score_b:', matchup.score_b);
  console.log('detailA:', JSON.stringify(detailA, null, 2));
  console.log('detailB:', JSON.stringify(detailB, null, 2));

  // Let's print each player's exact fixture points and slot points
  console.log('\n--- Starters Team A Breakdown ---');
  for (const s of matchup.lineup_a.starters) {
    const p = playersData.find(pl => pl.id === s.player_id);
    const rec = playerRecord.get(s.player_id);
    console.log(`${p.web_name} (${p.primary_position} in ${s.slot}): stored pts=${rec?.fixtures[0]?.fantasyPoints}, min=${rec?.fixtures[0]?.minutes}`);
  }

  console.log('\n--- Starters Team B Breakdown ---');
  for (const s of matchup.lineup_b.starters) {
    const p = playersData.find(pl => pl.id === s.player_id);
    const rec = playerRecord.get(s.player_id);
    console.log(`${p.web_name} (${p.primary_position} in ${s.slot}): stored pts=${rec?.fixtures[0]?.fantasyPoints}, min=${rec?.fixtures[0]?.minutes}`);
  }
}

run().catch(console.error);
