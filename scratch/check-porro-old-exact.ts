import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Let's implement the EXACT logic of origin/main's calculateMatchRating and loadReferenceStats
const ORIGIN_DEFAULT_REFERENCE_STATS: any = {
    GK:  { match_impact: { median: 12.00, stddev: 10.44 }, influence: { median: 21.20, stddev: 12.83 }, creativity: { median: 0.00, stddev: 2.18 }, threat: { median: 0.00, stddev: 2.38 }, defensive: { median: 0.50, stddev: 9.02 }, goal_involvement: { median: 0.00, stddev: 0.35 }, finishing: { median: 0.00, stddev: 0.04 }, save_score: { median: 4.00, stddev: 3.94 } },
    CB:  { match_impact: { median: 10.00, stddev: 10.12 }, influence: { median: 20.20, stddev: 12.28 }, creativity: { median: 1.40, stddev: 6.72 }, threat: { median: 2.00, stddev: 10.33 }, defensive: { median: 5.60, stddev: 9.37 }, goal_involvement: { median: 0.00, stddev: 1.55 }, finishing: { median: -0.010, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LB:  { match_impact: { median: 11.00, stddev: 10.43 }, influence: { median: 16.00, stddev: 10.60 }, creativity: { median: 7.90, stddev: 12.48 }, threat: { median: 4.00, stddev: 9.55 }, defensive: { median: 8.60, stddev: 9.64 }, goal_involvement: { median: 0.00, stddev: 1.62 }, finishing: { median: -0.028, stddev: 0.20 }, save_score: { median: 0.00, stddev: 1.00 } },
    RB:  { match_impact: { median: 11.00, stddev: 10.14 }, influence: { median: 15.30, stddev: 12.11 }, creativity: { median: 6.80, stddev: 12.08 }, threat: { median: 2.00, stddev: 7.87 }, defensive: { median: 9.95, stddev: 10.07 }, goal_involvement: { median: 0.00, stddev: 1.72 }, finishing: { median: -0.018, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LWB: { match_impact: { median: 9.00, stddev: 10.29 }, influence: { median: 14.60, stddev: 11.00 }, creativity: { median: 11.15, stddev: 13.75 }, threat: { median: 4.00, stddev: 9.54 }, defensive: { median: 8.85, stddev: 9.87 }, goal_involvement: { median: 0.00, stddev: 1.67 }, finishing: { median: -0.025, stddev: 0.21 }, save_score: { median: 0.00, stddev: 1.00 } },
    RWB: { match_impact: { median: 10.00, stddev: 10.02 }, influence: { median: 14.00, stddev: 11.72 }, creativity: { median: 11.20, stddev: 13.66 }, threat: { median: 2.00, stddev: 8.86 }, defensive: { median: 8.75, stddev: 9.94 }, goal_involvement: { median: 0.00, stddev: 1.92 }, finishing: { median: -0.020, stddev: 0.25 }, save_score: { median: 0.00, stddev: 1.00 } },
    DM:  { match_impact: { median: 14.00, stddev: 6.84 }, influence: { median: 13.40, stddev: 13.15 }, creativity: { median: 10.35, stddev: 13.71 }, threat: { median: 2.00, stddev: 9.82 }, defensive: { median: 10.90, stddev: 10.08 }, goal_involvement: { median: 0.00, stddev: 2.08 }, finishing: { median: -0.025, stddev: 0.28 }, save_score: { median: 0.00, stddev: 1.00 } },
    CM:  { match_impact: { median: 13.00, stddev: 6.83 }, influence: { median: 11.80, stddev: 14.36 }, creativity: { median: 14.80, stddev: 16.49 }, threat: { median: 6.00, stddev: 11.54 }, defensive: { median: 7.85, stddev: 7.37 }, goal_involvement: { median: 0.00, stddev: 2.45 }, finishing: { median: -0.045, stddev: 0.32 }, save_score: { median: 0.00, stddev: 1.00 } },
    AM:  { match_impact: { median: 12.00, stddev: 7.63 }, influence: { median: 11.20, stddev: 19.34 }, creativity: { median: 17.10, stddev: 18.95 }, threat: { median: 12.00, stddev: 15.09 }, defensive: { median: 6.10, stddev: 5.94 }, goal_involvement: { median: 0.00, stddev: 3.41 }, finishing: { median: -0.065, stddev: 0.45 }, save_score: { median: 0.00, stddev: 1.00 } },
    LW:  { match_impact: { median: 9.00, stddev: 7.49 }, influence: { median: 8.80, stddev: 16.47 }, creativity: { median: 14.40, stddev: 15.37 }, threat: { median: 12.00, stddev: 16.02 }, defensive: { median: 5.68, stddev: 5.60 }, goal_involvement: { median: 0.00, stddev: 2.85 }, finishing: { median: -0.070, stddev: 0.38 }, save_score: { median: 0.00, stddev: 1.00 } },
    RW:  { match_impact: { median: 10.00, stddev: 6.95 }, influence: { median: 10.60, stddev: 16.30 }, creativity: { median: 15.80, stddev: 16.17 }, threat: { median: 17.00, stddev: 15.91 }, defensive: { median: 5.73, stddev: 5.54 }, goal_involvement: { median: 0.00, stddev: 3.01 }, finishing: { median: -0.060, stddev: 0.40 }, save_score: { median: 0.00, stddev: 1.00 } },
    ST:  { match_impact: { median: 7.00, stddev: 9.26 }, influence: { median: 7.20, stddev: 20.66 }, creativity: { median: 6.10, stddev: 9.43 }, threat: { median: 19.00, stddev: 21.80 }, defensive: { median: 3.95, stddev: 5.35 }, goal_involvement: { median: 0.00, stddev: 3.76 }, finishing: { median: -0.040, stddev: 0.47 }, save_score: { median: 0.00, stddev: 1.00 } },
};

async function originLoadReferenceStats(admin: any, season: string) {
  const { data, error } = await admin
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', season);

  if (error || !data || data.length === 0) {
    return ORIGIN_DEFAULT_REFERENCE_STATS;
  }

  const ref = JSON.parse(JSON.stringify(ORIGIN_DEFAULT_REFERENCE_STATS));
  for (const row of data) {
    const pos = row.position_group;
    const comp = row.component;
    if (ref[pos] && ref[pos][comp]) {
      ref[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return ref;
}

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = 1.0 * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

const POSITION_WEIGHTS: any = {
    RB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    RWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
};

const FLEX_CONFIG: any = {
    RB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
    RWB: { flex: 0.25, components: ['creativity', 'threat', 'goal_involvement'] },
};

function originCalculateRating(stats: any, position: string, refStats: any, primaryPosition: string) {
    const ref = refStats[position] || ORIGIN_DEFAULT_REFERENCE_STATS[position];

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

    // Option B in origin/main
    if (primaryPosition === 'AM' && ['CB', 'LB', 'RB'].includes(position)) {
        finalPoints = finalPoints * 0.80;
    }

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(finalPoints * 10) / 10,
    };
}

(async () => {
  const { data: players } = await sb.from('players')
    .select('id, name')
    .ilike('name', '%Pedro%Porro%');

  const p = players![0];
  const refStats = await originLoadReferenceStats(sb, '2025-26');

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats')
    .eq('player_id', p.id);

  let playedCount = 0;
  let sumRb = 0;
  let sumRwb = 0;

  for (const r of statsRows || []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const rb = originCalculateRating(s, 'RB', refStats, 'RB').fantasyPoints;
    const rwb = originCalculateRating(s, 'RWB', refStats, 'RB').fantasyPoints;

    sumRb += rb;
    sumRwb += rwb;
  }

  console.log(`Played Games: ${playedCount}`);
  console.log(`PPG as RB under EXACT origin/main code: ${(sumRb / playedCount).toFixed(2)}`);
  console.log(`PPG as RWB under EXACT origin/main code: ${(sumRwb / playedCount).toFixed(2)}`);
})();
