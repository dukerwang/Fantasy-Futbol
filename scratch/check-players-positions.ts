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
  const names = ['James', 'Truffert', 'Frimpong', 'McGinn', 'Dorgu', 'O\'Brien'];
  for (const name of names) {
    const { data } = await supabase
      .from('players')
      .select('name, primary_position, secondary_positions, is_active')
      .ilike('name', `%${name}%`);
    console.log(`${name} in DB:`, data);
  }
})();
