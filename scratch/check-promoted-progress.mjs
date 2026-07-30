import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await admin.from('players').select('name, pl_team, primary_position, secondary_positions')
  .eq('is_active', true).in('pl_team', ['Hull City', 'Ipswich Town', 'Coventry City']);
const withSofifa = data.filter(p => p.secondary_positions && p.secondary_positions.length > 0);
const withoutSofifa = data.filter(p => !p.secondary_positions || p.secondary_positions.length === 0);
console.log(`Promoted clubs: ${data.length} active total | ${withSofifa.length} now have secondary_positions | ${withoutSofifa.length} still empty`);
console.log('\nStill empty (could be legit single-position, or still unmatched):');
withoutSofifa.forEach(p => console.log(' ', p.name.padEnd(28), p.pl_team.padEnd(14), p.primary_position));
