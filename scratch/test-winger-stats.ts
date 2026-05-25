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
  const players = [
    { name: "Son Heung-min", pos: "LW" },
    { name: "Luis Díaz Marulanda", pos: "LW" }
  ];

  for (const item of players) {
    const { data: pList } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`);
    
    console.log(`Searching for ${item.name}:`, pList);
    if (pList && pList.length > 0) {
      const p = pList[0];
      const { data: statsRows } = await supabase
        .from('player_stats')
        .select('id, stats')
        .eq('player_id', p.id);
      console.log(`  Stats count: ${statsRows?.length}`);
      if (statsRows && statsRows.length > 0) {
        const statsWithMin = statsRows.filter(r => r.stats && r.stats.minutes_played > 0);
        console.log(`  Stats with minutes > 0: ${statsWithMin.length}`);
      }
    }
  }
})();
