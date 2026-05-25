import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, curveFinalRating, computeScoringRating, calculateFantasyPoints } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats } from '@/types';

const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^\"|\"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const CONFIGS = [
  {
    name: 'Current V2 (Defensive Focus: 0.15 def, 0.05 goal_inv, 0.25 match_impact, 0.15 influence)',
    weights: {
      match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00
    },
    flexComponents: ['creativity', 'match_impact', 'defensive'],
  },
  {
    name: 'Older V2 (Balanced Focus: 0.10 def, 0.15 goal_inv, 0.20 match_impact, 0.10 influence)',
    weights: {
      match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00
    },
    flexComponents: ['creativity', 'match_impact', 'defensive'],
  }
];

function simulateMatchRating(
  stats: RawStats,
  position: GranularPosition,
  ref: any,
  config: typeof CONFIGS[0]
) {
  if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

  const components: any = {};
  
  const gc = stats.goals_conceded ?? 0;
  const xgc = stats.expected_goals_conceded ?? 0;
  
  let csBonus = 0;
  if (stats.clean_sheet && stats.minutes_played >= 60) {
    csBonus = 12;
  }
  
  const xgcOutperf = Math.max(0, xgc - gc) * 5;
  const gcPenalty = Math.max(0, gc - xgc) * 5;

  const tackles = Math.max(0, stats.fpl_tackles ?? 0);
  const cbi = Math.max(0, stats.fpl_cbi ?? 0);
  const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
  const dc = Math.max(0, stats.fpl_def_contrib ?? 0);

  let defActionsRaw = dc + recoveries * 0.5;
  const defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;

  components.defensive = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);
  components.match_impact = sigmoidNormalize(stats.bps ?? 0, ref.match_impact.median, ref.match_impact.stddev);
  
  // FIXED KEYS HERE! PULL FROM stats directly
  components.influence = sigmoidNormalize(parseFloat((stats.influence ?? 0).toString()), ref.influence.median, ref.influence.stddev);
  components.creativity = sigmoidNormalize(parseFloat((stats.creativity ?? 0).toString()), ref.creativity.median, ref.creativity.stddev);
  components.threat = sigmoidNormalize(parseFloat((stats.threat ?? 0).toString()), ref.threat.median, ref.threat.stddev);
  
  components.goal_involvement = sigmoidNormalize(
    (stats.goals_scored ?? 0) * 12 + (stats.assists ?? 0) * 8 + (stats.expected_goals ?? 0) * 4 + (stats.expected_assists ?? 0) * 3,
    ref.goal_involvement.median,
    ref.goal_involvement.stddev
  );
  components.finishing = 0;
  components.save_score = 0;

  // Apply flex
  let bestComp = config.flexComponents[0];
  let maxVal = -1;
  for (const c of config.flexComponents) {
    if (components[c] > maxVal) {
      maxVal = components[c];
      bestComp = c;
    }
  }

  const finalWeights = { ...config.weights } as any;
  finalWeights[bestComp] = (finalWeights[bestComp] ?? 0) + 0.25;

  let composite = 0;
  for (const [k, w] of Object.entries(finalWeights)) {
    composite += (components[k] ?? 0) * (w as number);
  }

  const scoringRating = Math.max(1.0, Math.min(10.0, 1.0 + 9.0 * composite));
  const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
  let finalPoints = 0.0 + (10.0 * curve);
  if (scoringRating < 3.0) finalPoints -= 2.0;

  return {
    rating: scoringRating,
    fantasyPoints: Math.max(0, Number(finalPoints.toFixed(1)))
  };
}

(async () => {
  // Load database reference stats for season 2025-26
  const { data: refData } = await sb.from('rating_reference_stats').select('position_group, component, median, stddev').eq('season', '2025-26');
  const refStats: any = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  if (refData && refData.length > 0) {
    for (const row of refData) {
      const pos = row.position_group;
      const comp = row.component;
      if (refStats[pos] && refStats[pos][comp]) {
        refStats[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
      }
    }
  }

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%' + name.replace('Muñoz', 'Mun') + '%');
    if (!found || found.length === 0) continue;
    const p = found[0];
    const { data: statsRows } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', p.id).not('stats','is',null);

    console.log(`\n========================================`);
    console.log(`${p.name} (${p.primary_position})`);
    
    for (const conf of CONFIGS) {
      let gp = 0;
      let sumPts = 0;
      for (const r of statsRows ?? []) {
        const s = r.stats as any;
        if (!s || s.minutes_played === 0) continue;
        gp++;
        const simulated = simulateMatchRating(s, p.primary_position, refStats[p.primary_position], conf);
        sumPts += simulated.fantasyPoints;
      }
      console.log(`  ${conf.name}:`);
      console.log(`    PPG: ${(sumPts/gp).toFixed(2)} (${gp} games)`);
    }
  }
})();
