import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Let's copy the OLD code's DEFAULT_REFERENCE_STATS
const OLD_REFERENCE_STATS: any = {
    GK:  { match_impact: { median: 12.00, stddev: 10.44 }, influence: { median: 21.20, stddev: 12.83 }, creativity: { median: 0.00, stddev: 2.18 }, threat: { median: 0.00, stddev: 2.38 }, defensive: { median: 0.50, stddev: 9.02 }, goal_involvement: { median: 0.00, stddev: 0.35 }, finishing: { median: 0.00, stddev: 0.04 }, save_score: { median: 4.00, stddev: 3.94 } },
    CB:  { match_impact: { median: 10.00, stddev: 10.12 }, influence: { median: 20.20, stddev: 12.28 }, creativity: { median: 1.40, stddev: 6.72 }, threat: { median: 2.00, stddev: 10.33 }, defensive: { median: 5.60, stddev: 9.37 }, goal_involvement: { median: 0.00, stddev: 1.55 }, finishing: { median: -0.010, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LB:  { match_impact: { median: 11.00, stddev: 10.43 }, influence: { median: 16.00, stddev: 10.60 }, creativity: { median: 7.90, stddev: 12.48 }, threat: { median: 4.00, stddev: 9.55 }, defensive: { median: 8.60, stddev: 9.64 }, goal_involvement: { median: 0.00, stddev: 1.62 }, finishing: { median: -0.028, stddev: 0.20 }, save_score: { median: 0.00, stddev: 1.00 } },
    RB:  { match_impact: { median: 11.00, stddev: 10.14 }, influence: { median: 15.30, stddev: 12.11 }, creativity: { median: 6.80, stddev: 12.08 }, threat: { median: 2.00, stddev: 7.87 }, defensive: { median: 9.95, stddev: 10.07 }, goal_involvement: { median: 0.00, stddev: 1.72 }, finishing: { median: -0.018, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LWB: { match_impact: { median: 9.00, stddev: 10.29 }, influence: { median: 14.60, stddev: 11.00 }, creativity: { median: 11.15, stddev: 13.75 }, threat: { median: 4.00, stddev: 9.54 }, defensive: { median: 8.85, stddev: 9.87 }, goal_involvement: { median: 0.00, stddev: 1.67 }, finishing: { median: -0.025, stddev: 0.21 }, save_score: { median: 0.00, stddev: 1.00 } },
    RWB: { match_impact: { median: 10.00, stddev: 10.02 }, influence: { median: 14.00, stddev: 11.72 }, creativity: { median: 11.20, stddev: 13.66 }, threat: { median: 2.00, stddev: 8.86 }, defensive: { median: 8.75, stddev: 9.94 }, goal_involvement: { median: 0.00, stddev: 1.92 }, finishing: { median: -0.020, stddev: 0.25 }, save_score: { median: 0.00, stddev: 1.00 } },
};

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// We will write a function mimicking the OLD calculateMatchRating!
function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = 1.0 * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

// ACTUAL OLD WEIGHTS FROM origin/main
const POSITION_WEIGHTS: any = {
    RB: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    RWB: { match_impact: 0.15, influence: 0.05, creativity: 0.20, threat: 0.05, defensive: 0.10, goal_involvement: 0.20, finishing: 0.00, save_score: 0.00 },
};

const FLEX_CONFIG: any = {
    RB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
    RWB: { flex: 0.25, components: ['creativity', 'threat', 'goal_involvement'] },
};

function oldCalculateRating(stats: any, position: string, primaryPosition: string) {
    const ref = OLD_REFERENCE_STATS[position];

    //adjusted bps
    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const match_impact = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);
    const influence = sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);
    const creativity = sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);
    const threat = sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev);

    // defensive
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        csBonus = 12;
    }
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const dc = stats.fpl_def_contrib ?? 0;
    const recoveries = stats.fpl_recoveries ?? 0;
    
    // In old code: defActionsRaw = dc + recoveries * 0.5;
    const defActionsRaw = dc + recoveries * 0.5;
    const defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;
    const defensive = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);

    // goal involvement
    const g = stats.goals;
    const a = stats.assists;
    const goalInvRaw = g * 6 + a * 4;
    const goal_involvement = sigmoidNormalize(goalInvRaw, 0, 2.5);

    // finishing
    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const finInput = (g - xg) + (a - xa) * 0.5;
    const finishing = sigmoidNormalize(finInput, -0.03, 0.28);

    const scores: any = { match_impact, influence, creativity, threat, defensive, goal_involvement, finishing, save_score: 0.5 };

    // Apply weights
    const weights = POSITION_WEIGHTS[position];
    const flexConfig = FLEX_CONFIG[position];

    let maxScore = -1;
    let maxComponent = '';
    for (const key of flexConfig.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(weights)) {
        let finalWeight = weights[key];
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

    // curve display rating
    const rating = 3.0 + 7.0 * composite;

    // fantasy points
    const scoringRating = 1.0 + 9.0 * composite;
    const curve = Math.pow(Math.max(0, scoringRating - 4.5) / 2.0, 1.5);
    let finalPoints = 10.0 * curve;
    if (scoringRating < 3.0) finalPoints -= 2.0;
    finalPoints = Math.max(0, finalPoints);

    // No OOP penalty since Porro is a defender

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(finalPoints * 10) / 10,
    };
}

(async () => {
  const { data: players } = await sb.from('players')
    .select('id, name')
    .ilike('name', '%Pedro Porro%');

  const p = players![0];

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats, fantasy_points_v2')
    .eq('player_id', p.id);

  let playedCount = 0;
  let sumRb = 0;
  let sumRwb = 0;

  for (const r of statsRows || []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const rb = oldCalculateRating(s, 'RB', 'RB').fantasyPoints;
    const rwb = oldCalculateRating(s, 'RWB', 'RB').fantasyPoints;

    sumRb += rb;
    sumRwb += rwb;
  }

  console.log(`Played Games: ${playedCount}`);
  console.log(`PPG as RB under OLD weights : ${(sumRb / playedCount).toFixed(2)}`);
  console.log(`PPG as RWB under OLD weights: ${(sumRwb / playedCount).toFixed(2)}`);
})();
