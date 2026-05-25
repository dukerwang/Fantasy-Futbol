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
    .eq('is_active', true);

  if (!players) {
    console.error("No players found");
    return;
  }

  const attackers = ['AM', 'LW', 'RW', 'ST'];
  const defenders = ['CB', 'LB', 'RB', 'LWB', 'RWB'];

  const matched = players.filter(p => {
    if (!attackers.includes(p.primary_position)) return false;
    const sec = p.secondary_positions || [];
    return sec.some((s: string) => defenders.includes(s));
  });

  console.log(`Found ${matched.length} players who are primary ATTACKERS and secondary DEFENDERS:`);
  for (const p of matched) {
    console.log(`- ${p.name} (Primary: ${p.primary_position}, Secondary: ${JSON.stringify(p.secondary_positions)})`);
  }
})();
