import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, getPositionGroup, curveFinalRating, calculateFantasyPoints } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats } from '@/types';

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

const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;
const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

const ORIGINAL_WEIGHTS = {
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00 },
};

const PROPOSED_WEIGHTS = {
  CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00 },
};

const FLEX_CONFIG = {
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
};

async function run() {
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
        finishing: { median: r.finishing_median, stddev: r.finishing_stddev },
        save_score: { median: r.save_score_median, stddev: r.save_score_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  const playersToTest = ["Enzo Fernández", "Morgan Rogers", "Phil Foden", "Bruno Fernandes"];
  const refCM = refStats.CM;

  console.log("=== ANALYZING COMPONENT-BY-COMPONENT SCORE DIFFERENCES (CM SLOT) ===");

  for (const name of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${name}%`);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let totalGames = 0;
    let sumTackles = 0, sumRecoveries = 0, sumBps = 0, sumDefensiveRaw = 0, sumThreat = 0;
    let sumGoalInvolvement = 0, sumCreativity = 0, sumInfluence = 0;
    
    let scoreMatchImpactSum = 0;
    let scoreInfluenceSum = 0;
    let scoreCreativitySum = 0;
    let scoreThreatSum = 0;
    let scoreDefensiveSum = 0;
    let scoreGoalInvolvementSum = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      totalGames++;

      // Stats
      const rawBps = stats.bps ?? 0;
      const goalAssistBps = stats.goals * 12 + stats.assists * 9;
      const adjustedBps = Math.max(0, rawBps - goalAssistBps);

      const tackles = stats.fpl_tackles ?? 0;
      const recoveries = stats.fpl_recoveries ?? 0;
      const dc = stats.fpl_def_contrib ?? 0;

      const csBonus = (stats.clean_sheet && stats.minutes_played >= 60) ? 4 : 0;
      const gc = stats.goals_conceded;
      const xgc = stats.expected_goals_conceded ?? 0;
      const xgcOutperf = Math.max(0, xgc - gc) * 5;
      const gcPenalty = Math.max(0, gc - xgc) * 5;
      const defensiveRaw = dc + csBonus + xgcOutperf - gcPenalty;

      sumTackles += tackles;
      sumRecoveries += recoveries;
      sumBps += adjustedBps;
      sumDefensiveRaw += defensiveRaw;
      sumThreat += (stats.threat ?? 0);
      sumCreativity += (stats.creativity ?? 0);
      sumInfluence += (stats.influence ?? 0);
      sumGoalInvolvement += (stats.goals * 6 + stats.assists * 4);

      // Components
      scoreMatchImpactSum += sigmoidNormalize(adjustedBps, refCM.match_impact.median, refCM.match_impact.stddev);
      scoreInfluenceSum += sigmoidNormalize(stats.influence ?? 0, refCM.influence.median, refCM.influence.stddev);
      scoreCreativitySum += sigmoidNormalize(stats.creativity ?? 0, refCM.creativity.median, refCM.creativity.stddev);
      scoreThreatSum += sigmoidNormalize(stats.threat ?? 0, refCM.threat.median, refCM.threat.stddev);
      scoreDefensiveSum += sigmoidNormalize(defensiveRaw, refCM.defensive.median, refCM.defensive.stddev);
      scoreGoalInvolvementSum += sigmoidNormalize(stats.goals * 6 + stats.assists * 4, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV);
    }

    if (totalGames === 0) continue;

    console.log(`\nPlayer: ${p.name} (Primary: ${p.primary_position})`);
    console.log(`Games Played: ${totalGames}`);
    console.log(`Raw Averages per Game:`);
    console.log(`  - Adjusted Bps    : ${(sumBps / totalGames).toFixed(1)}`);
    console.log(`  - Tackles         : ${(sumTackles / totalGames).toFixed(2)}`);
    console.log(`  - Recoveries      : ${(sumRecoveries / totalGames).toFixed(2)}`);
    console.log(`  - Defensive Raw   : ${(sumDefensiveRaw / totalGames).toFixed(1)}`);
    console.log(`  - Threat          : ${(sumThreat / totalGames).toFixed(1)}`);
    console.log(`  - Creativity      : ${(sumCreativity / totalGames).toFixed(1)}`);
    console.log(`  - Influence       : ${(sumInfluence / totalGames).toFixed(1)}`);
    console.log(`  - Goal Involvement: ${(sumGoalInvolvement / totalGames).toFixed(1)}`);
    
    console.log(`Component Sigmoid Scores (0.0 to 1.0):`);
    console.log(`  - Match Impact (BPS): ${(scoreMatchImpactSum / totalGames).toFixed(3)}`);
    console.log(`  - Influence         : ${(scoreInfluenceSum / totalGames).toFixed(3)}`);
    console.log(`  - Creativity        : ${(scoreCreativitySum / totalGames).toFixed(3)}`);
    console.log(`  - Threat            : ${(scoreThreatSum / totalGames).toFixed(3)}`);
    console.log(`  - Defensive         : ${(scoreDefensiveSum / totalGames).toFixed(3)}`);
    console.log(`  - Goal Involvement  : ${(scoreGoalInvolvementSum / totalGames).toFixed(3)}`);
  }
}

run();
