/**
 * One-off verification: did the top-5-league SoFIFA scrape actually land in
 * sofifa_position_reference, and does syncPlayers.ts's matching logic
 * (normalizeName + firstLastWord) actually find real players in it?
 *
 * Usage: node scratch/verify_sofifa_reference.mjs
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

function loadEnvLocal() {
  const lines = fs.readFileSync('.env.local', 'utf-8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}
loadEnvLocal();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function normalizeName(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstLastWord(name) {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

const { count } = await db
  .from('sofifa_position_reference')
  .select('*', { count: 'exact', head: true });
console.log(`[count] ${count} rows in sofifa_position_reference\n`);

// PostgREST caps an unpaged .select() at 1000 rows by default -- page through
// explicitly or this silently under-counts.
const leagueCounts = {};
for (let from = 0; from < count; from += 1000) {
  const { data: page } = await db
    .from('sofifa_position_reference')
    .select('sofifa_league_id')
    .range(from, from + 999);
  for (const r of page ?? []) leagueCounts[r.sofifa_league_id] = (leagueCounts[r.sofifa_league_id] ?? 0) + 1;
}
console.log('[per league]', leagueCounts, '\n');

// Simulate syncPlayers.ts's actual lookup against a few real, currently
// non-Prem players who plausibly could be a future Prem transfer target.
const testNames = [
  'Kylian Mbappe',
  'Jude Bellingham', // already Prem-departed -> Real Madrid, should still be in La Liga scrape
  'Victor Osimhen',
  'Michael Olise', // already actually in the Prem in our players table -- expect NOT relevant here, just a sanity name
];

for (const fplStyleName of testNames) {
  const aliasNorm = normalizeName(fplStyleName);
  const { data: hit } = await db
    .from('sofifa_position_reference')
    .select('full_name, common_name, club_name, primary_position, secondary_positions')
    .contains('name_aliases', [aliasNorm])
    .maybeSingle();

  const { data: hitFirstLast } = hit ? { data: null } : await db
    .from('sofifa_position_reference')
    .select('full_name, common_name, club_name, primary_position, secondary_positions')
    .contains('name_aliases', [firstLastWord(aliasNorm)])
    .maybeSingle();

  const match = hit ?? hitFirstLast;
  console.log(
    `"${fplStyleName}" ->`,
    match ? `MATCHED: ${match.full_name} (${match.common_name}) @ ${match.club_name} — ${match.primary_position} / [${match.secondary_positions}]` : 'NO MATCH',
  );
}
