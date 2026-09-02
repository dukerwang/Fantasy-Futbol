import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { getLatestReferenceStatsSeason } from '../src/lib/season/currentSeason.ts';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';

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
  const latestSeason = await getLatestReferenceStatsSeason(admin);
  console.log('Latest reference stats season:', latestSeason);

  const { data: seasons } = await admin
    .from('rating_reference_stats')
    .select('season')
    .limit(100);
  const uniqueSeasons = [...new Set(seasons?.map(s => s.season))];
  console.log('Seasons in rating_reference_stats table:', uniqueSeasons);

  const ref = await loadReferenceStats(admin, latestSeason);
  console.log('CB match_impact ref:', ref.CB.match_impact);
  console.log('DM match_impact ref:', ref.DM.match_impact);
  console.log('ST match_impact ref:', ref.ST.match_impact);
  console.log('AM match_impact ref:', ref.AM.match_impact);
}

run().catch(console.error);
