import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { RawStats, ReferenceStats } from '@/types';

// Let's load the pooled wide-defender stats we computed earlier
const newFbStats = {
  GK:  { match_impact: { median: 12.00, stddev: 10.17 }, influence: { median: 21.00, stddev: 12.42 }, creativity: { median: 0.00, stddev: 2.08 }, threat: { median: 0.00, stddev: 1.29 }, defensive: { median: 3.50, stddev: 10.72 }, goal_involvement: { median: 0.00, stddev: 0.33 }, finishing: { median: 0.000, stddev: 0.04 }, save_score: { median: 6.00, stddev: 4.55 } },
  CB:  { match_impact: { median: 10.00, stddev: 9.84 }, influence: { median: 20.00, stddev: 11.85 }, creativity: { median: 1.40, stddev: 6.41 }, threat: { median: 2.00, stddev: 10.33 }, defensive: { median: 8.80, stddev: 9.19 }, goal_involvement: { median: 0.00, stddev: 1.55 }, finishing: { median: -0.010, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
  LB:  { match_impact: { median: 10.00, stddev: 10.029 }, influence: { median: 14.40, stddev: 10.815 }, creativity: { median: 9.875, stddev: 13.265 }, threat: { median: 3.00, stddev: 8.823 }, defensive: { median: 12.05, stddev: 9.606 }, goal_involvement: { median: 0.00, stddev: 1.719 }, finishing: { median: -0.020, stddev: 0.221 }, save_score: { median: 0.00, stddev: 1.00 } },
  RB:  { match_impact: { median: 10.00, stddev: 10.029 }, influence: { median: 14.40, stddev: 10.815 }, creativity: { median: 9.875, stddev: 13.265 }, threat: { median: 3.00, stddev: 8.823 }, defensive: { median: 12.05, stddev: 9.606 }, goal_involvement: { median: 0.00, stddev: 1.719 }, finishing: { median: -0.020, stddev: 0.221 }, save_score: { median: 0.00, stddev: 1.00 } },
  LWB: { match_impact: { median: 10.00, stddev: 10.029 }, influence: { median: 14.40, stddev: 10.815 }, creativity: { median: 9.875, stddev: 13.265 }, threat: { median: 3.00, stddev: 8.823 }, defensive: { median: 12.05, stddev: 9.606 }, goal_involvement: { median: 0.00, stddev: 1.719 }, finishing: { median: -0.020, stddev: 0.221 }, save_score: { median: 0.00, stddev: 1.00 } },
  RWB: { match_impact: { median: 10.00, stddev: 10.029 }, influence: { median: 14.40, stddev: 10.815 }, creativity: { median: 9.875, stddev: 13.265 }, threat: { median: 3.00, stddev: 8.823 }, defensive: { median: 12.05, stddev: 9.606 }, goal_involvement: { median: 0.00, stddev: 1.719 }, finishing: { median: -0.020, stddev: 0.221 }, save_score: { median: 0.00, stddev: 1.00 } },
  DM:  { match_impact: { median: 14.00, stddev: 6.57 }, influence: { median: 13.40, stddev: 12.96 }, creativity: { median: 10.50, stddev: 13.26 }, threat: { median: 2.00, stddev: 9.62 }, defensive: { median: 18.30, stddev: 7.44 }, goal_involvement: { median: 0.00, stddev: 2.06 }, finishing: { median: -0.025, stddev: 0.28 }, save_score: { median: 0.00, stddev: 1.00 } },
  CM:  { match_impact: { median: 13.00, stddev: 6.71 }, influence: { median: 12.00, stddev: 14.24 }, creativity: { median: 15.00, stddev: 15.81 }, threat: { median: 6.00, stddev: 11.59 }, defensive: { median: 14.50, stddev: 5.60 }, goal_involvement: { median: 0.00, stddev: 2.46 }, finishing: { median: -0.045, stddev: 0.32 }, save_score: { median: 0.00, stddev: 1.00 } },
  AM:  { match_impact: { median: 12.00, stddev: 7.69 }, influence: { median: 11.20, stddev: 19.28 }, creativity: { median: 17.10, stddev: 19.55 }, threat: { median: 12.00, stddev: 15.09 }, defensive: { median: 11.50, stddev: 5.49 }, goal_involvement: { median: 0.00, stddev: 3.40 }, finishing: { median: -0.065, stddev: 0.45 }, save_score: { median: 0.00, stddev: 1.00 } },
  LW:  { match_impact: { median: 10.00, stddev: 7.02 }, influence: { median: 9.60, stddev: 16.12 }, creativity: { median: 15.20, stddev: 15.29 }, threat: { median: 14.00, stddev: 15.63 }, defensive: { median: 10.60, stddev: 4.95 }, goal_involvement: { median: 0.00, stddev: 2.91 }, finishing: { median: -0.065, stddev: 0.39 }, save_score: { median: 0.00, stddev: 1.00 } },
  RW:  { match_impact: { median: 10.00, stddev: 7.02 }, influence: { median: 9.60, stddev: 16.12 }, creativity: { median: 15.20, stddev: 15.29 }, threat: { median: 14.00, stddev: 15.63 }, defensive: { median: 10.60, stddev: 4.95 }, goal_involvement: { median: 0.00, stddev: 2.91 }, finishing: { median: -0.065, stddev: 0.39 }, save_score: { median: 0.00, stddev: 1.00 } },
  ST:  { match_impact: { median: 6.00, stddev: 9.21 }, influence: { median: 6.80, stddev: 20.62 }, creativity: { median: 6.10, stddev: 9.30 }, threat: { median: 19.00, stddev: 21.93 }, defensive: { median: 9.00, stddev: 4.29 }, goal_involvement: { median: 0.00, stddev: 3.77 }, finishing: { median: -0.050, stddev: 0.47 }, save_score: { median: 0.00, stddev: 1.00 } }
};

// Halftime Masterclass stats profile
const masterclassStats: RawStats = {
  minutes_played: 45,
  goals: 0,
  assists: 1, // High-impact assist!
  shots_total: 1,
  shots_on_target: 0,
  passes_total: 35,
  passes_accurate: 32,
  pass_completion_pct: 91,
  key_passes: 3, // 3 Key Passes in 45 mins!
  big_chances_created: 1,
  dribbles_attempted: 2,
  dribbles_successful: 2,
  tackles_total: 3,
  tackles_won: 3, // 3 Tackles won in 45 mins!
  interceptions: 2,
  clearances: 2,
  blocks: 1,
  saves: 0,
  goals_conceded: 0, // No goals conceded while on the pitch!
  penalty_saves: 0,
  yellow_cards: 0,
  red_cards: 0,
  own_goals: 0,
  penalties_missed: 0,
  clean_sheet: false, // Under 60 mins, so CS is false officially
  bps: 22, // 22 BPS in 45 mins is extremely high! (equivalent to 44 BPS full match)
  influence: 28.5,
  creativity: 32.4, // Extremely high creativity (rate of 65 per 90!)
  threat: 12.0,
  ict_index: 7.3,
  expected_goals: 0.05,
  expected_assists: 0.35,
  expected_goals_conceded: 0.45,
  fpl_tackles: 3,
  fpl_cbi: 5,
  fpl_recoveries: 4, // 4 recoveries
  fpl_def_contrib: 8
};

const result = calculateMatchRating(masterclassStats, 'RB', newFbStats as any);
console.log('=== Halftime Masterclass Simulation Result ===');
console.log(`Rating: ${result.rating}`);
console.log(`Points: ${result.fantasyPoints}`);
console.log('\nBreakdown:');
for (const item of result.breakdown) {
  console.log(`  ${item.component.padEnd(20)}: Score = ${item.score.toFixed(3)} | Weight = ${item.weight.toFixed(2)} | Weighted = ${item.weighted.toFixed(3)} | Detail = ${item.detail}`);
}
