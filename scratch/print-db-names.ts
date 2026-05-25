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
    .select('name, primary_position, fpl_id')
    .limit(30);

  console.log("=== DB PLAYER NAMES ===");
  dbPlayers?.forEach(p => {
    console.log(`- ${p.name} (Position: ${p.primary_position}, FPL ID: ${p.fpl_id})`);
  });
})();
