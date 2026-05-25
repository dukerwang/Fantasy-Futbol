import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Custom lightweight env loader for .env.local
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  console.error("Failed to load .env.local manually:", e);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  if (!players || players.length === 0) return;

  const p = players[0];
  await supabase
    .from('players')
    .update({ secondary_positions: ['RB', 'CM'] })
    .eq('id', p.id);

  const { data: updated } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .eq('id', p.id);

  console.log(`Restored DB entry: ${updated?.[0]?.name} - Secondary: ${JSON.stringify(updated?.[0]?.secondary_positions)}`);
})();
