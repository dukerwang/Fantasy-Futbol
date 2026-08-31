import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadPriorityPlayerIds } from '../src/lib/outlook/population';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const ids = await loadPriorityPlayerIds(admin);
const { data } = await admin
  .from('players')
  .select('id, web_name, pl_team, market_value')
  .in('id', ids.slice(0, 12));
const order = new Map(ids.map((id, i) => [id, i]));
console.log(`priority pool: ${ids.length} players`);
console.log(`estimated grounded requests for a full priority run: ~${ids.length * 2 + 20}`);
console.log('\nfirst twelve:');
for (const p of (data ?? []).sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
  console.log(`  ${String(p.web_name).padEnd(16)} ${String(p.pl_team).padEnd(14)} €${p.market_value}m`);
}
