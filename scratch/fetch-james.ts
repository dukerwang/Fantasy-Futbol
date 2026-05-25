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
  const targets = ["Cole Palmer", "Bukayo Saka", "Mohamed Salah", "Erling Haaland"];
  
  console.log("=== COMPARING RAW STATS FOR PREMIUMS (2025/26) ===");
  
  for (const name of targets) {
    const { data: pList } = await supabase
      .from('players')
      .select('id, name, primary_position, ppg')
      .ilike('name', `%${name}%`);

    if (!pList || pList.length === 0) {
      console.log(`❌ Player "${name}" not found!`);
      continue;
    }
    const p = pList[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      console.log(`❌ No stats rows for ${p.name}`);
      continue;
    }

    let gp = 0;
    let sumMins = 0, sumGoals = 0, sumAssists = 0, sumBps = 0;
    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;
      sumMins += stats.minutes_played;
      sumGoals += (stats.goals ?? 0);
      sumAssists += (stats.assists ?? 0);
      sumBps += (stats.bps ?? 0);
    }

    console.log(`Player: ${p.name} (${p.primary_position}) | Current PPG in DB: ${p.ppg}`);
    console.log(`  Games: ${gp} | Avg Mins: ${(sumMins / gp).toFixed(1)}`);
    console.log(`  Total Goals  : ${sumGoals} | Total Assists: ${sumAssists}`);
    console.log(`  Avg FPL BPS  : ${(sumBps / gp).toFixed(1)}`);
    console.log("--------------------------------------------------");
  }
})();
