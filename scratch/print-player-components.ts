import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition, ReferenceStats } from '@/types';

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

const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

(async () => {
  // Load Reference Stats
  const { data: refData } = await supabase
    .from('rating_reference_stats')
    .select('*')
    .eq('season', '2025/26');
  
  const refStats: any = {};
  if (refData && refData.length > 0) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact: { median: r.match_impact_median, stddev: r.match_impact_stddev },
        influence: { median: r.influence_median, stddev: r.influence_stddev },
        creativity: { median: r.creativity_median, stddev: r.creativity_stddev },
        threat: { median: r.threat_median, stddev: r.threat_stddev },
        defensive: { median: r.defensive_median, stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

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
    const pos = p.primary_position as 'DM' | 'CM';
    const ref = refStats[pos] ?? refStats.CM;

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats, gameweek')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumMatchImpact = 0, sumInfluence = 0, sumCreativity = 0, sumDefensive = 0;
    let sumDefActions = 0, sumBps = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      gp++;

      const teamGc = fixtureGoalsConceded[`${r.gameweek}_${p.pl_team_id}`] ?? 0;
      
      const xgc = stats.expected_goals_conceded ?? 0;
      const gc = teamGc;
      
      const xgcOutperf = Math.max(0, xgc - gc) * 2;
      const gcPenalty = Math.max(0, gc - xgc) * 2;
      const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
      const defensiveRaw = dc + (stats.clean_sheet ? 12 : 0) + xgcOutperf - gcPenalty;

      const rawBps = stats.bps ?? 0;
      const goalAssistBps = stats.goals * 12 + stats.assists * 9;
      const adjustedBps = Math.max(0, rawBps - goalAssistBps);

      sumMatchImpact += sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);
      sumInfluence += sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);
      sumCreativity += sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);
      sumDefensive += sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);
      sumDefActions += defensiveRaw;
      sumBps += adjustedBps;
    }

    console.log(`=== AVERAGES FOR ${p.name} (${pos}) ===`);
    console.log(`Games: ${gp}`);
    console.log(`Raw Adj BPS: ${(sumBps/gp).toFixed(2)} | Score Match Impact: ${(sumMatchImpact/gp).toFixed(3)}`);
    console.log(`Raw Influence: ${((refStats[pos] ? ref.influence.median : 0) + 1).toFixed(1)} (Median: ${ref.influence.median})`);
    console.log(`Score Influence: ${(sumInfluence/gp).toFixed(3)}`);
    console.log(`Score Creativity: ${(sumCreativity/gp).toFixed(3)}`);
    console.log(`Raw Defensive: ${(sumDefActions/gp).toFixed(2)} | Score Defensive: ${(sumDefensive/gp).toFixed(3)}`);
    console.log('--------------------------------------------------\n');
  }
})();
