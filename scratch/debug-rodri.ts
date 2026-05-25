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

async function run() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position')
    .eq('name', "Rodrigo 'Rodri' Hernandez Cascante");

  console.log(players);
  if (players && players.length > 0) {
    const p = players[0];
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (statsRows && statsRows.length > 0) {
      let gp = 0;
      let totalMins = 0;
      let totalBps = 0;
      let totalTackles = 0;
      let totalCbi = 0;
      let totalRecoveries = 0;
      let totalDefContrib = 0;
      let totalCleanSheets = 0;
      let totalGoals = 0;
      let totalAssists = 0;

      for (const r of statsRows) {
        const stats = r.stats as any;
        if (!stats || stats.minutes_played === 0) continue;
        gp++;
        totalMins += stats.minutes_played;
        totalBps += (stats.bps ?? 0);
        totalTackles += (stats.fpl_tackles ?? 0);
        totalCbi += (stats.fpl_cbi ?? 0);
        totalRecoveries += (stats.fpl_recoveries ?? 0);
        totalDefContrib += (stats.fpl_def_contrib ?? 0);
        if (stats.clean_sheet && stats.minutes_played >= 60) {
          totalCleanSheets++;
        }
        totalGoals += (stats.goals ?? 0);
        totalAssists += (stats.assists ?? 0);
      }

      console.log(`Player: ${p.name}`);
      console.log(`  Games: ${gp} | Avg Mins: ${(totalMins / gp).toFixed(1)}`);
      console.log(`  Avg BPS     : ${(totalBps / gp).toFixed(1)}`);
      console.log(`  Avg Tackles : ${(totalTackles / gp).toFixed(2)}`);
      console.log(`  Avg CBI     : ${(totalCbi / gp).toFixed(2)}`);
      console.log(`  Avg Recov   : ${(totalRecoveries / gp).toFixed(2)}`);
      console.log(`  Avg DefCtr  : ${(totalDefContrib / gp).toFixed(2)}`);
      console.log(`  Clean Sheets: ${totalCleanSheets} (${((totalCleanSheets / gp) * 100).toFixed(0)}%)`);
      console.log(`  Goals/Assts : ${totalGoals} G / ${totalAssists} A`);
    }
  }
}
run();
