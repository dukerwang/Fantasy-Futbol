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
  const { data: wingers } = await supabase
    .from('players')
    .select('id, name, primary_position')
    .in('primary_position', ['LW', 'RW']);

  console.log(`Total wingers in DB: ${wingers?.length}`);
  const activeWingers = [];

  for (const w of wingers || []) {
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', w.id);
    
    if (statsRows && statsRows.length > 0) {
      const playedGames = statsRows.filter(r => r.stats && r.stats.minutes_played > 0);
      if (playedGames.length > 0) {
        activeWingers.push({ name: w.name, pos: w.primary_position, games: playedGames.length });
      }
    }
  }

  // Sort by games desc
  activeWingers.sort((a, b) => b.games - a.games);
  console.log("Top active wingers with actual minutes:");
  console.log(activeWingers.slice(0, 15).map(w => `  - ${w.name} (${w.pos}) | games: ${w.games}`).join('\n'));
})();
