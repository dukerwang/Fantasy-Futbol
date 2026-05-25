import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name')
    .ilike('name', '%Moisés Caicedo%');

  if (!dbPlayers || dbPlayers.length === 0) return;
  const p = dbPlayers[0];

  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null)
    .limit(10);

  if (!statsRows || statsRows.length === 0) return;

  const allKeys = new Set<string>();
  const nonZeroAverages: Record<string, number> = {};
  let count = 0;

  for (const r of statsRows) {
    const stats = r.stats as any;
    if (!stats) continue;
    count++;
    for (const [k, v] of Object.entries(stats)) {
      allKeys.add(k);
      if (typeof v === 'number' && v > 0) {
        nonZeroAverages[k] = (nonZeroAverages[k] ?? 0) + v;
      }
    }
  }

  console.log("=== Moisés Caicedo Stats Keys Averages (when > 0) ===");
  for (const k of allKeys) {
    const sum = nonZeroAverages[k] ?? 0;
    console.log(`- ${k.padEnd(25)}: ${(sum/count).toFixed(2)}`);
  }
})();
