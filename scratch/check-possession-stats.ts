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
  const { data } = await supabase
    .from('player_stats')
    .select('stats')
    .not('stats', 'is', null)
    .limit(20);

  if (!data || data.length === 0) {
    console.log("No player stats found.");
    return;
  }

  console.log("Sample stats keys:");
  console.log(Object.keys(data[0].stats));

  console.log("\nSample passes_total / pass_completion_pct values:");
  for (let i = 0; i < Math.min(data.length, 5); i++) {
    const s = data[i].stats as any;
    console.log(`passes_total: ${s.passes_total}, passes_accurate: ${s.passes_accurate}, pct: ${s.pass_completion_pct}`);
  }
})();
