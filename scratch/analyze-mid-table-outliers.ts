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
  const players = ["James Garner", "Elliot Anderson", "Moisés Caicedo", "Rodri"];
  
  console.log("=== ANALYZING MID-TABLE OUTLIERS VS PREMIUM DMs ===");

  for (const name of players) {
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

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumTackles = 0, sumRecoveries = 0, sumBps = 0, sumCleanSheets = 0, sumMins = 0;
    let sumGoals = 0, sumAssists = 0, sumExpectedGoals = 0, sumExpectedAssists = 0;
    let sumCreativity = 0, sumInfluence = 0, sumThreat = 0, sumDefContrib = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;
      sumMins += stats.minutes_played;
      sumTackles += (stats.fpl_tackles ?? 0);
      sumRecoveries += (stats.fpl_recoveries ?? 0);
      sumBps += (stats.bps ?? 0);
      sumCleanSheets += stats.clean_sheet ? 1 : 0;
      sumGoals += (stats.goals ?? 0);
      sumAssists += (stats.assists ?? 0);
      sumExpectedGoals += (stats.expected_goals ?? 0);
      sumExpectedAssists += (stats.expected_assists ?? 0);
      sumCreativity += (stats.creativity ?? 0);
      sumInfluence += (stats.influence ?? 0);
      sumThreat += (stats.threat ?? 0);
      sumDefContrib += (stats.fpl_def_contrib ?? 0);
    }

    if (gp === 0) continue;

    console.log(`\nPlayer: ${p.name} (Primary: ${p.primary_position}) | Current PPG in DB: ${p.ppg}`);
    console.log(`Games: ${gp} | Avg Mins: ${(sumMins / gp).toFixed(1)}`);
    console.log(`Raw Averages per Game:`);
    console.log(`  - Goals           : ${(sumGoals / gp).toFixed(2)} (xG: ${(sumExpectedGoals / gp).toFixed(2)})`);
    console.log(`  - Assists         : ${(sumAssists / gp).toFixed(2)} (xA: ${(sumExpectedAssists / gp).toFixed(2)})`);
    console.log(`  - FPL BPS         : ${(sumBps / gp).toFixed(1)}`);
    console.log(`  - Tackles         : ${(sumTackles / gp).toFixed(2)}`);
    console.log(`  - Recoveries      : ${(sumRecoveries / gp).toFixed(2)}`);
    console.log(`  - Def Contrib (DC): ${(sumDefContrib / gp).toFixed(2)}`);
    console.log(`  - Clean Sheets    : ${(sumCleanSheets / gp * 100).toFixed(1)}%`);
    console.log(`  - FPL Influence   : ${(sumInfluence / gp).toFixed(1)}`);
    console.log(`  - FPL Creativity  : ${(sumCreativity / gp).toFixed(1)}`);
    console.log(`  - FPL Threat      : ${(sumThreat / gp).toFixed(1)}`);
  }
})();
