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
  const wirtz = await supabase.from('players').select('id, name, primary_position').ilike('name', '%Wirtz%');
  const enzo = await supabase.from('players').select('id, name, primary_position').ilike('name', '%Enzo%');
  const szobo = await supabase.from('players').select('id, name, primary_position').ilike('name', '%Szoboszlai%');
  const pedro = await supabase.from('players').select('id, name, primary_position').ilike('name', '%Pedro%');

  console.log("Wirtz:", wirtz.data);
  console.log("Enzo:", enzo.data);
  console.log("Szoboszlai:", szobo.data);
  console.log("Pedro:", pedro.data);
})();
