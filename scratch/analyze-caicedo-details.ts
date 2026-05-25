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
  const players = ["Moisés Caicedo", "Rodrigo 'Rodri' Hernandez", "James Garner", "Elliot Anderson"];
  
  for (const name of players) {
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, primary_position, pl_team_id')
      .ilike('name', `%${name}%`);

    if (!dbPlayers || dbPlayers.length === 0) continue;
    const p = dbPlayers[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats, gameweek')
      .eq('player_id', p.id)
      .not('stats', 'is', null)
      .order('gameweek', { ascending: true });

    if (!statsRows || statsRows.length === 0) continue;

    console.log(`\n=== DETAILED MATCH STATS FOR ${p.name} ===`);
    let count = 0;
    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      count++;
      if (count > 5) break; // print first 5 matches as a sample
      console.log(`GW${r.gameweek} | Mins: ${stats.minutes_played} | BPS: ${stats.bps} | Infl: ${stats.influence} | Crea: ${stats.creativity} | DefCont: ${stats.fpl_def_contrib} | xGC: ${stats.expected_goals_conceded.toFixed(2)} | CS: ${stats.clean_sheet ? 1 : 0}`);
    }
  }
})();
