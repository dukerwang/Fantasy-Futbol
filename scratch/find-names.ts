import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env
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
  const names = ['Maddison', 'Son', 'Díaz', 'Diaz', 'Palmer', 'Saka', 'Salah', 'Bruno', 'Fernandes', 'Silva', 'De Bruyne', 'Szoboszlai'];
  for (const n of names) {
    const { data: players } = await supabase
      .from('players')
      .select('name, primary_position')
      .ilike('name', `%${n}%`);
    console.log(`Querying ${n}:`);
    console.log(players?.map(p => `  - ${p.name} (${p.primary_position})`).join('\n'));
  }
})();
