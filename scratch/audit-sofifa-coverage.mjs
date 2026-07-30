import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('players')
    .select('id, fpl_id, name, web_name, pl_team, primary_position, secondary_positions, sofifa_common_name, is_active')
    .eq('is_active', true)
    .range(from, from + 999);
  if (error) throw error;
  all = all.concat(data);
  if (data.length < 1000) break;
}

const missingSofifa = all.filter(p => !p.sofifa_common_name);
console.log('Active players total:', all.length);
console.log('Active players missing sofifa_common_name:', missingSofifa.length);

const byClub = new Map();
for (const p of missingSofifa) {
  const k = p.pl_team ?? 'NULL';
  byClub.set(k, (byClub.get(k) ?? 0) + 1);
}
console.log('\n--- missing sofifa, by club ---');
[...byClub.entries()].sort((a,b)=>b[1]-a[1]).forEach(([club,c]) => console.log(club.padEnd(20), c));

console.log('\n--- sample of missing (30) ---');
missingSofifa.slice(0, 30).forEach(p => console.log(p.name.padEnd(28), p.pl_team.padEnd(16), p.primary_position, JSON.stringify(p.secondary_positions)));

// how many have secondary_positions non-empty (evidence sofifa DID run for them at some point, even if name field wasn't backfilled)
const hasSecondaryButNoCommonName = missingSofifa.filter(p => p.secondary_positions && p.secondary_positions.length > 0);
console.log('\nmissing sofifa_common_name but HAS secondary_positions (i.e. sofifa matched before, just name field blank):', hasSecondaryButNoCommonName.length);
