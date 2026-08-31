/** Read-only: run the computed facet layer over the real pool and report shape. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { computeFacets } from '@futbolpedia/engine';
import { loadFacetInputs } from '../src/lib/outlook/facetInputs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const { inputs, season, priorSeason } = await loadFacetInputs(admin);
console.log(`seasons: current ${season}, prior ${priorSeason}; players ${inputs.size}\n`);

const tally: Record<string, Record<string, number>> = {};
const bump = (k: string, v: string) => {
  tally[k] ??= {};
  tally[k][v] = (tally[k][v] ?? 0) + 1;
};

const facetsById = new Map<string, ReturnType<typeof computeFacets>>();
for (const [id, i] of inputs) {
  const f = computeFacets(i);
  facetsById.set(id, f);
  bump('minutes_role', f.minutes_role);
  bump('attacking_involvement', f.attacking_involvement);
  bump('career_phase', f.career_phase);
  bump('dynasty_value', f.dynasty_value);
  bump('set_pieces', f.set_pieces.length ? f.set_pieces.join('+') : '(none)');
  for (const r of f.risk_flags) bump('risk_flags', r);
}

for (const [facet, counts] of Object.entries(tally)) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(facet);
  for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(26)} ${String(n).padStart(4)}  ${((n / total) * 100).toFixed(0)}%`);
  }
  console.log();
}

const names = ['Palmer', 'Tarkowski', 'Haaland', 'Estêvão', 'Martinelli', 'Bentancur', 'Saliba'];
const { data: rows } = await admin
  .from('players')
  .select('id, web_name, primary_position')
  .in('web_name', names);

console.log('spot checks');
for (const r of rows ?? []) {
  const f = facetsById.get(r.id);
  const i = inputs.get(r.id);
  if (!f || !i) continue;
  console.log(
    `  ${r.web_name.padEnd(12)} ${r.primary_position.padEnd(4)} age ${String(i.age).padStart(2)}  ` +
      `${f.minutes_role.padEnd(15)} ${f.attacking_involvement.padEnd(17)} ${f.career_phase.padEnd(12)} ` +
      `${f.dynasty_value.padEnd(16)} sp:[${f.set_pieces.join(',')}]`,
  );
}
