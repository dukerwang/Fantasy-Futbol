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
  const names = ['James Garner', 'Elliot Anderson'];
  for (const name of names) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', `%${name}%`);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null)
      .limit(10);

    console.log(`=== STATS FOR ${p.name} ===`);
    if (statsRows) {
      for (const r of statsRows) {
        const stats = r.stats as any;
        console.log(`Mins: ${stats.minutes_played} | GC: ${stats.goals_conceded} | xGC: ${stats.expected_goals_conceded} | CS: ${stats.clean_sheet} | BPS: ${stats.bps} | DC: ${stats.fpl_def_contrib}`);
      }
    }
    console.log('------------------------------\n');
  }
})();
