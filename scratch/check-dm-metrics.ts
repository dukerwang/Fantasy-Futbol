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
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumDefActions = 0, sumBps = 0, sumMinutes = 0, sumTackles = 0, sumCbi = 0, sumRecoveries = 0;
    let sumXgc = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 45) continue;
      gp++;
      sumMinutes += stats.minutes_played;
      sumDefActions += stats.fpl_def_contrib ?? 0;
      sumBps += stats.bps ?? 0;
      sumTackles += stats.fpl_tackles ?? 0;
      sumCbi += stats.fpl_cbi ?? 0;
      sumRecoveries += stats.fpl_recoveries ?? 0;
      sumXgc += stats.expected_goals_conceded ?? 0;
    }

    console.log(`=== AVERAGES FOR ${p.name} (${p.primary_position}) ===`);
    console.log(`Games: ${gp} | Avg Mins: ${(sumMinutes/gp).toFixed(1)}`);
    console.log(`Avg Tackles: ${(sumTackles/gp).toFixed(2)} | Avg CBI: ${(sumCbi/gp).toFixed(2)} | Avg Recoveries: ${(sumRecoveries/gp).toFixed(2)}`);
    console.log(`Avg Def Contrib: ${(sumDefActions/gp).toFixed(2)} | Avg BPS: ${(sumBps/gp).toFixed(1)} | Avg xGC: ${(sumXgc/gp).toFixed(2)}`);
    console.log('--------------------------------------------------\n');
  }
})();
