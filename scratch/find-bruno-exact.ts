import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Custom env loader
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        process.env[key] = value;
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Bruno%');

  if (players) {
    for (const p of players) {
      console.log(`ID: ${p.id}, Name: ${p.name}, Primary: ${p.primary_position}, Secondary: ${JSON.stringify(p.secondary_positions)}`);
    }
  }
})();
