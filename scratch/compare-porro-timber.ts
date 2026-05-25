import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating } from '../src/lib/scoring/matchRating';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const playersList = ['Pedro Porro', 'Jurriën Timber'];
  const refData = await sb.from('rating_reference_stats').select('*').eq('season', '2025/26');
  const refStats: any = {};
  for (const r of refData.data ?? []) {
    refStats[r.position] = refStats[r.position] || {};
    refStats[r.position][r.component] = { median: r.median, stddev: r.stddev };
  }

  for (const name of playersList) {
    const { data: found } = await sb.from('players').select('id, name, primary_position').ilike('name', `%${name}%`);
    if (!found?.length) { console.log(`${name}: NOT FOUND`); continue; }
    const p = found[0];

    const { data: stats } = await sb.from('player_stats').select('stats, gameweek, fantasy_points_v2').eq('player_id', p.id).not('stats','is',null);
    const valid = stats?.filter(s => (s.stats?.minutes_played ?? 0) >= 45) ?? [];

    let sumBps = 0, sumAdjBps = 0, sumCreativity = 0, sumTackles = 0, sumCbi = 0, sumRecoveries = 0, sumDefContrib = 0, sumExpectedAssists = 0;
    let sumGI = 0, sumInfluence = 0, sumConceded = 0, sumXgc = 0, sumCS = 0;
    
    let sumCompScores: Record<string, number> = {};
    let totalPts = 0;

    for (const s of valid) {
      const st = s.stats as any;
      sumBps += st.bps ?? 0;
      const goalBps = (st.goals ?? 0) * 12 + (st.assists ?? 0) * 9;
      sumAdjBps += Math.max(0, (st.bps ?? 0) - goalBps);
      sumCreativity += st.creativity ?? 0;
      sumTackles += st.fpl_tackles ?? 0;
      sumCbi += st.fpl_cbi ?? 0;
      sumRecoveries += st.fpl_recoveries ?? 0;
      sumDefContrib += st.fpl_def_contrib ?? 0;
      sumExpectedAssists += st.expected_assists ?? 0;
      sumGI += (st.goals ?? 0) * 6 + (st.assists ?? 0) * 4;
      sumInfluence += st.influence ?? 0;
      sumConceded += st.goals_conceded ?? 0;
      sumXgc += st.expected_goals_conceded ?? 0;
      if (st.clean_sheet) sumCS++;

      // Run rating to get component scores
      const res = calculateMatchRating(st, 'RB', refStats);
      totalPts += res.fantasyPoints;
      
      // Calculate individual component scores (not weighted)
      // We will rebuild this using the internal scores
    }

    const n = valid.length;
    console.log(`\n==================================================`);
    console.log(`${p.name} (${p.primary_position}) — ${n} games (>= 45 mins)`);
    console.log(`--------------------------------------------------`);
    console.log(`Avg PPG (45+ mins V2): ${(totalPts/n).toFixed(2)}`);
    console.log(`Avg Minutes Played:    ${(valid.reduce((acc, s) => acc + (s.stats as any).minutes_played, 0) / n).toFixed(1)}`);
    console.log(`Avg Clean Sheets:      ${(sumCS/n * 100).toFixed(1)}% (${sumCS} CS)`);
    console.log(`Avg Goals Conceded:    ${(sumConceded/n).toFixed(2)}`);
    console.log(`Avg Expected GC:       ${(sumXgc/n).toFixed(2)}`);
    console.log(`Avg Raw BPS:           ${(sumBps/n).toFixed(2)}`);
    console.log(`Avg Adjusted BPS:      ${(sumAdjBps/n).toFixed(2)}`);
    console.log(`Avg Creativity:        ${(sumCreativity/n).toFixed(2)}`);
    console.log(`Avg Expected Assists:  ${(sumExpectedAssists/n).toFixed(3)}`);
    console.log(`Avg Influence:         ${(sumInfluence/n).toFixed(2)}`);
    console.log(`Avg Goal Involvement:  ${(sumGI/n).toFixed(2)}`);
    console.log(`Avg Tackles Won:       ${(sumTackles/n).toFixed(2)}`);
    console.log(`Avg CBI Actions:       ${(sumCbi/n).toFixed(2)}`);
    console.log(`Avg Ball Recoveries:   ${(sumRecoveries/n).toFixed(2)}`);
    console.log(`Avg Def Contribution:  ${(sumDefContrib/n).toFixed(2)}`);
  }
})();
