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
  const { data: matchups } = await admin
    .from('matchups')
    .select('*, league:leagues(name), team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .in('gameweek', [1, 2])
    .eq('status', 'completed');

  console.log(`Found ${matchups?.length} completed matchups in GW 1-2`);
  for (const m of matchups || []) {
    console.log(`[${m.league?.name}] GW${m.gameweek}: ${m.team_a?.team_name} ${m.score_a} - ${m.score_b} ${m.team_b?.team_name}`);
  }
}

run().catch(console.error);
