import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: positions } = await sb.from('players').select('primary_position');
  const counts: Record<string, number> = {};
  for (const p of positions ?? []) {
    counts[p.primary_position] = (counts[p.primary_position] ?? 0) + 1;
  }
  console.log('Player counts by primary_position:');
  console.log(Object.entries(counts).sort((a,b) => b[1] - a[1]));
})();
