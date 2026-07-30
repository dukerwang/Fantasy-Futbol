import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin.from('players')
    .select('name, pl_team, primary_position, secondary_positions, sofifa_common_name')
    .eq('is_active', true).range(from, from + 999);
  if (error) throw error;
  all = all.concat(data);
  if (data.length < 1000) break;
}

const suspects = all.filter(p => {
  const sec = p.secondary_positions || [];
  return (p.primary_position === 'LB' && sec.includes('LW')) ||
         (p.primary_position === 'RB' && sec.includes('RW'));
});

console.log(`Total active: ${all.length}`);
console.log(`Suspect FB-primary + pure-winger-secondary combos: ${suspects.length}\n`);
suspects.forEach(p => console.log(
  p.name.padEnd(28), p.pl_team.padEnd(16), p.primary_position, JSON.stringify(p.secondary_positions), '| sofifa_common_name:', p.sofifa_common_name
));
