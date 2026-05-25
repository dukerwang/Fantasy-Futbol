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
  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('stats')
    .not('stats', 'is', null)
    .limit(5);

  if (statsRows) {
    for (let i = 0; i < statsRows.length; i++) {
      console.log(`--- Row ${i + 1} ---`);
      console.log(JSON.stringify(statsRows[i].stats, null, 2));
    }
  }
})();
