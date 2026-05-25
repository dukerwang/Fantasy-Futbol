import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%' + name.replace('Muñoz', 'Mun') + '%');
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    let totalMins = 0;
    let playedGames = 0;
    let sumCreativity = 0;
    let sumDefContrib = 0;
    let sumRecoveries = 0;
    let sumBps = 0;
    let sumCleanSheets = 0;
    let sumGoalsConceded = 0;
    let sumXGC = 0;
    let sumTackles = 0;
    let sumCbi = 0;

    for (const r of statsRows ?? []) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      playedGames++;
      totalMins += s.minutes_played;
      sumCreativity += s.creativity ?? 0;
      sumDefContrib += s.fpl_def_contrib ?? 0;
      sumRecoveries += s.fpl_recoveries ?? 0;
      sumBps += s.bps ?? 0;
      if (s.clean_sheet) sumCleanSheets++;
      sumGoalsConceded += s.goals_conceded ?? 0;
      sumXGC += s.expected_goals_conceded ?? 0;
      sumTackles += s.fpl_tackles ?? 0;
      sumCbi += s.fpl_cbi ?? 0;
    }

    console.log(`\n========================================`);
    console.log(`${p.name} (${p.primary_position}) — ${playedGames} games played`);
    console.log(`  Avg minutes per game: ${(totalMins / playedGames).toFixed(1)}`);
    console.log(`  Average raw stats per game:`);
    console.log(`    BPS                    : ${(sumBps / playedGames).toFixed(2)}`);
    console.log(`    Creativity             : ${(sumCreativity / playedGames).toFixed(2)}`);
    console.log(`    Defensive Contribution : ${(sumDefContrib / playedGames).toFixed(2)}`);
    console.log(`    Recoveries             : ${(sumRecoveries / playedGames).toFixed(2)}`);
    console.log(`    Tackles                : ${(sumTackles / playedGames).toFixed(2)}`);
    console.log(`    CBI (Clear/Block/Inter): ${(sumCbi / playedGames).toFixed(2)}`);
    console.log(`    Clean Sheets           : ${(sumCleanSheets / playedGames * 100).toFixed(1)}%`);
    console.log(`    Goals Conceded         : ${(sumGoalsConceded / playedGames).toFixed(2)}`);
    console.log(`    Expected GC (xGC)      : ${(sumXGC / playedGames).toFixed(2)}`);
  }
})();
