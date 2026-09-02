import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

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
  console.log('=== 1. GW2 MATCHDAY MILITIA INVESTIGATION ===');
  
  const { data: matchup } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('id', 'b1f0be6c-c9ab-4250-b13b-36623408530b')
    .single();

  console.log(`Matchup: ${matchup.team_a.team_name} (${matchup.score_a}) vs ${matchup.team_b.team_name} (${matchup.score_b})`);
  
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

  console.log('\n--- TEAM A: Hayden FC Starters ---');
  for (const s of matchup.lineup_a.starters) {
    const p = playerMap.get(s.player_id);
    const st = statsMap.get(s.player_id);
    console.log(`Slot ${s.slot}: ${p?.name} (${p?.primary_position}, ${p?.pl_team}) - Rating: ${st?.match_rating}, Pts: ${st?.fantasy_points}, Min: ${st?.raw_stats?.minutes_played}, G: ${st?.raw_stats?.goals}, A: ${st?.raw_stats?.assists}, CS: ${st?.raw_stats?.clean_sheet}, GC: ${st?.raw_stats?.goals_conceded}, BPS: ${st?.raw_stats?.bps}, Inf: ${st?.raw_stats?.influence}, Cre: ${st?.raw_stats?.creativity}, Thr: ${st?.raw_stats?.threat}`);
  }

  console.log('\n--- TEAM B: Not Too Xabi Starters ---');
  for (const s of matchup.lineup_b.starters) {
    const p = playerMap.get(s.player_id);
    const st = statsMap.get(s.player_id);
    console.log(`Slot ${s.slot}: ${p?.name} (${p?.primary_position}, ${p?.pl_team}) - Rating: ${st?.match_rating}, Pts: ${st?.fantasy_points}, Min: ${st?.raw_stats?.minutes_played}, G: ${st?.raw_stats?.goals}, A: ${st?.raw_stats?.assists}, CS: ${st?.raw_stats?.clean_sheet}, GC: ${st?.raw_stats?.goals_conceded}, BPS: ${st?.raw_stats?.bps}, Inf: ${st?.raw_stats?.influence}, Cre: ${st?.raw_stats?.creativity}, Thr: ${st?.raw_stats?.threat}`);
  }
}

run().catch(console.error);
