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

  const fixtureGoalsConceded: Record<string, number> = {};
  for (let gw = 1; gw <= 35; gw++) {
    try {
      const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`);
      if (!res.ok) continue;
      const fixtures = await res.json() as any[];
      for (const f of fixtures) {
        if (f.team_h_score !== null && f.team_h_score !== undefined && f.team_a_score !== null && f.team_a_score !== undefined) {
          fixtureGoalsConceded[`${gw}_${f.team_h}`] = f.team_a_score;
          fixtureGoalsConceded[`${gw}_${f.team_a}`] = f.team_h_score;
        }
      }
    } catch (e) {}
  }

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
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumBps = 0, sumInfluence = 0, sumCreativity = 0, sumThreat = 0, sumDefContrib = 0, sumXgc = 0, sumGc = 0, sumCs = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      gp++;

      const teamGc = fixtureGoalsConceded[`${r.gameweek}_${p.pl_team_id}`] ?? 0;

      sumBps += stats.bps ?? 0;
      sumInfluence += stats.influence ?? 0;
      sumCreativity += stats.creativity ?? 0;
      sumThreat += stats.threat ?? 0;
      sumDefContrib += stats.fpl_def_contrib ?? 0;
      sumXgc += stats.expected_goals_conceded ?? 0;
      sumGc += teamGc;
      if (stats.clean_sheet) sumCs++;
    }

    console.log(`=== REAL RAW AVERAGES FOR ${p.name} (${p.primary_position}) ===`);
    console.log(`Games: ${gp}`);
    console.log(`BPS: ${(sumBps/gp).toFixed(2)}`);
    console.log(`Influence: ${(sumInfluence/gp).toFixed(2)}`);
    console.log(`Creativity: ${(sumCreativity/gp).toFixed(2)}`);
    console.log(`Threat: ${(sumThreat/gp).toFixed(2)}`);
    console.log(`Def Contrib: ${(sumDefContrib/gp).toFixed(2)}`);
    console.log(`xGC: ${(sumXgc/gp).toFixed(2)} | GC: ${(sumGc/gp).toFixed(2)} | CS%: ${((sumCs/gp)*100).toFixed(1)}%`);
    console.log('--------------------------------------------------\n');
  }
})();
