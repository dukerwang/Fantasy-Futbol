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
  const { data: topScorers } = await admin
    .from('player_stats')
    .select('player_id, gameweek, fantasy_points, match_rating, stats')
    .eq('season', '2026-27')
    .eq('gameweek', 2)
    .order('fantasy_points', { ascending: false })
    .limit(30);

  const playerIds = topScorers.map(s => s.player_id);
  const { data: players } = await admin
    .from('players')
    .select('id, name, web_name, primary_position, pl_team')
    .in('id', playerIds);
  const pMap = new Map(players.map(p => [p.id, p]));

  console.log('Top Scorers in GW2 (2026-27):');
  for (const s of topScorers) {
    const p = pMap.get(s.player_id);
    console.log(`${s.fantasy_points.toString().padStart(5)} pts | Rating ${s.match_rating} | ${p?.primary_position.padEnd(3)} | ${(p?.web_name || p?.name).padEnd(15)} | ${p?.pl_team.padEnd(12)} | G: ${s.stats?.goals}, A: ${s.stats?.assists}, CS: ${s.stats?.clean_sheet ? 1 : 0}, BPS: ${s.stats?.bps}`);
  }
}

run().catch(console.error);
