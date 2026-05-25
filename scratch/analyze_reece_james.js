const { calculateMatchRating, POSITION_WEIGHTS } = require('../src/lib/scoring/matchRating');
const { calculateMatchRatingV1 } = require('../src/lib/scoring/matchRatingV1Legacy');

// Reece James player statistics fetched from database
const games = [
  { gameweek: 1, minutes: 78, bps: 29, goals: 0, assists: 0, fpl_cbi: 6, influence: 17, creativity: 46.6, clean_sheet: true, fpl_tackles: 1, expected_goals: 0, fpl_recoveries: 6, goals_conceded: 0, fpl_def_contrib: 7, expected_assists: 0.19, expected_goals_conceded: 0.61 },
  { gameweek: 2, minutes: 21, bps: 7, goals: 0, assists: 0, fpl_cbi: 0, influence: 2.6, creativity: 15.5, clean_sheet: false, fpl_tackles: 0, expected_goals: 0, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 0, expected_assists: 0.13, expected_goals_conceded: 0.44 },
  { gameweek: 3, minutes: 9, bps: 4, goals: 0, assists: 0, fpl_cbi: 0, influence: 3.4, creativity: 0.3, clean_sheet: false, fpl_tackles: 0, expected_goals: 0.04, fpl_recoveries: 0, goals_conceded: 0, fpl_def_contrib: 0, expected_assists: 0, expected_goals_conceded: 0.68 },
  { gameweek: 4, minutes: 45, bps: 8, goals: 0, assists: 0, fpl_cbi: 2, influence: 6.6, creativity: 3.3, clean_sheet: false, fpl_tackles: 0, expected_goals: 0.04, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 2, expected_assists: 0.02, expected_goals_conceded: 0.87 },
  { gameweek: 5, minutes: 90, bps: 16, goals: 0, assists: 1, fpl_cbi: 6, influence: 27.4, creativity: 32.8, clean_sheet: false, fpl_tackles: 3, expected_goals: 0, fpl_recoveries: 5, goals_conceded: 2, fpl_def_contrib: 9, expected_assists: 0.16, expected_goals_conceded: 1.84 },
  { gameweek: 6, minutes: 90, bps: 11, goals: 0, assists: 1, fpl_cbi: 4, influence: 13.8, creativity: 18, clean_sheet: false, fpl_tackles: 1, expected_goals: 0.05, fpl_recoveries: 1, goals_conceded: 3, fpl_def_contrib: 5, expected_assists: 0.3, expected_goals_conceded: 2.28 },
  { gameweek: 7, minutes: 90, bps: 16, goals: 0, assists: 0, fpl_cbi: 5, influence: 25.8, creativity: 23.2, clean_sheet: false, fpl_tackles: 5, expected_goals: 0, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 10, expected_assists: 0.06, expected_goals_conceded: 1.95 },
  { gameweek: 8, minutes: 90, bps: 53, goals: 1, assists: 1, fpl_cbi: 2, influence: 65.4, creativity: 28, clean_sheet: true, fpl_tackles: 1, expected_goals: 0.21, fpl_recoveries: 5, goals_conceded: 0, fpl_def_contrib: 3, expected_assists: 0.03, expected_goals_conceded: 2.35 },
  { gameweek: 9, minutes: 90, bps: 15, goals: 0, assists: 0, fpl_cbi: 0, influence: 20.2, creativity: 31.3, clean_sheet: false, fpl_tackles: 3, expected_goals: 0, fpl_recoveries: 8, goals_conceded: 2, fpl_def_contrib: 3, expected_assists: 0.12, expected_goals_conceded: 1.31 },
  { gameweek: 10, minutes: 90, bps: 29, goals: 0, assists: 0, fpl_cbi: 6, influence: 18.2, creativity: 18.8, clean_sheet: true, fpl_tackles: 3, expected_goals: 0.14, fpl_recoveries: 8, goals_conceded: 0, fpl_def_contrib: 9, expected_assists: 0.47, expected_goals_conceded: 0.1 },
  { gameweek: 11, minutes: 13, bps: 2, goals: 0, assists: 0, fpl_cbi: 0, influence: 0, creativity: 1.3, clean_sheet: false, fpl_tackles: 0, expected_goals: 0, fpl_recoveries: 1, goals_conceded: 0, fpl_def_contrib: 0, expected_assists: 0.01, expected_goals_conceded: 0.14 },
  { gameweek: 12, minutes: 45, bps: 9, goals: 0, assists: 0, fpl_cbi: 1, influence: 5.4, creativity: 1.2, clean_sheet: false, fpl_tackles: 1, expected_goals: 0, fpl_recoveries: 4, goals_conceded: 0, fpl_def_contrib: 2, expected_assists: 0.01, expected_goals_conceded: 0.27 },
  { gameweek: 13, minutes: 90, bps: 30, goals: 0, assists: 1, fpl_cbi: 2, influence: 28.2, creativity: 35.3, clean_sheet: false, fpl_tackles: 1, expected_goals: 0.02, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 3, expected_assists: 0.16, expected_goals_conceded: 1.26 },
  { gameweek: 15, minutes: 90, bps: 22, goals: 0, assists: 0, fpl_cbi: 5, influence: 18.2, creativity: 5, clean_sheet: true, fpl_tackles: 4, expected_goals: 0, fpl_recoveries: 4, goals_conceded: 0, fpl_def_contrib: 9, expected_assists: 0.02, expected_goals_conceded: 1.42 },
  { gameweek: 16, minutes: 90, bps: 28, goals: 0, assists: 0, fpl_cbi: 2, influence: 13, creativity: 21.3, clean_sheet: true, fpl_tackles: 1, expected_goals: 0.09, fpl_recoveries: 6, goals_conceded: 0, fpl_def_contrib: 3, expected_assists: 0.05, expected_goals_conceded: 1.03 },
  { gameweek: 17, minutes: 90, bps: 19, goals: 1, assists: 0, fpl_cbi: 2, influence: 42, creativity: 11.3, clean_sheet: false, fpl_tackles: 2, expected_goals: 0.15, fpl_recoveries: 0, goals_conceded: 2, fpl_def_contrib: 4, expected_assists: 0.07, expected_goals_conceded: 2.31 },
  { gameweek: 18, minutes: 90, bps: 31, goals: 0, assists: 1, fpl_cbi: 3, influence: 41, creativity: 47.2, clean_sheet: false, fpl_tackles: 7, expected_goals: 0.12, fpl_recoveries: 7, goals_conceded: 2, fpl_def_contrib: 10, expected_assists: 0.27, expected_goals_conceded: 1.19 },
  { gameweek: 19, minutes: 45, bps: 7, goals: 0, assists: 0, fpl_cbi: 1, influence: 6.8, creativity: 7.9, clean_sheet: false, fpl_tackles: 2, expected_goals: 0, fpl_recoveries: 3, goals_conceded: 0, fpl_def_contrib: 3, expected_assists: 0.03, expected_goals_conceded: 0.37 },
  { gameweek: 20, minutes: 90, bps: 3, goals: 0, assists: 0, fpl_cbi: 3, influence: 3.6, creativity: 6, clean_sheet: false, fpl_tackles: 2, expected_goals: 0, fpl_recoveries: 7, goals_conceded: 0, fpl_def_contrib: 5, expected_assists: 0.03, expected_goals_conceded: 0.99 },
  { gameweek: 21, minutes: 25, bps: 2, goals: 0, assists: 0, fpl_cbi: 5, influence: 18.4, creativity: 14.3, clean_sheet: false, fpl_tackles: 0, expected_goals: 0, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 5, expected_assists: 0.01, expected_goals_conceded: 0.57 },
  { gameweek: 22, minutes: 84, bps: 31, goals: 0, assists: 0, fpl_cbi: 6, influence: 10, creativity: 5.3, clean_sheet: true, fpl_tackles: 2, expected_goals: 0, fpl_recoveries: 3, goals_conceded: 0, fpl_def_contrib: 8, expected_assists: 0.01, expected_goals_conceded: 1.36 },
  { gameweek: 23, minutes: 80, bps: 26, goals: 0, assists: 0, fpl_cbi: 4, influence: 17.6, creativity: 20.1, clean_sheet: true, fpl_tackles: 1, expected_goals: 0, fpl_recoveries: 2, goals_conceded: 0, fpl_def_contrib: 5, expected_assists: 0.14, expected_goals_conceded: 0.82 },
  { gameweek: 24, minutes: 9, bps: 4, goals: 0, assists: 0, fpl_cbi: 0, influence: 2.2, creativity: 5.5, clean_sheet: false, fpl_tackles: 0, expected_goals: 0, fpl_recoveries: 1, goals_conceded: 0, fpl_def_contrib: 0, expected_assists: 0.01, expected_goals_conceded: 0.2 },
  { gameweek: 27, minutes: 88, bps: 26, goals: 0, assists: 0, fpl_cbi: 3, influence: 10.2, creativity: 5.3, clean_sheet: true, fpl_tackles: 3, expected_goals: 0, fpl_recoveries: 1, goals_conceded: 0, fpl_def_contrib: 6, expected_assists: 0.02, expected_goals_conceded: 0.56 },
  { gameweek: 28, minutes: 90, bps: 26, goals: 0, assists: 1, fpl_cbi: 3, influence: 0.8, creativity: 0.2, clean_sheet: false, fpl_tackles: 3, expected_goals: 0, fpl_recoveries: 6, goals_conceded: 2, fpl_def_contrib: 6, expected_assists: 0.35, expected_goals_conceded: 1.13 },
  { gameweek: 29, minutes: 90, bps: 12, goals: 0, assists: 0, fpl_cbi: 3, influence: 10.8, creativity: 9.4, clean_sheet: false, fpl_tackles: 1, expected_goals: 0.04, fpl_recoveries: 3, goals_conceded: 0, fpl_def_contrib: 4, expected_assists: 0.02, expected_goals_conceded: 0.78 },
  { gameweek: 30, minutes: 90, bps: 13, goals: 0, assists: 0, fpl_cbi: 3, influence: 17.8, creativity: 66.4, clean_sheet: false, fpl_tackles: 0, expected_goals: 0.12, fpl_recoveries: 4, goals_conceded: 0, fpl_def_contrib: 3, expected_assists: 0.46, expected_goals_conceded: 1.41 },
  { gameweek: 36, minutes: 27, bps: 9, goals: 0, assists: 0, fpl_cbi: 3, influence: 7.6, creativity: 1.3, clean_sheet: false, fpl_tackles: 1, expected_goals: 0, fpl_recoveries: 4, goals_conceded: 0, fpl_def_contrib: 4, expected_assists: 0.01, expected_goals_conceded: 0.05 }
];

function makeRef(mi, inf, cre, thr, def, gi, fin, sav) {
  return {
    match_impact: { median: mi[0], stddev: mi[1] },
    influence: { median: inf[0], stddev: inf[1] },
    creativity: { median: cre[0], stddev: cre[1] },
    threat: { median: thr[0], stddev: thr[1] },
    defensive: { median: def[0], stddev: def[1] },
    goal_involvement: { median: gi[0], stddev: gi[1] },
    finishing: { median: fin[0], stddev: fin[1] },
    save_score: { median: sav[0], stddev: sav[1] }
  };
}

// New Unified Wide Defender Reference Stats (computed from LB+RB+LWB+RWB games)
const newFbStats = {
  GK:  makeRef([12.00, 10.17], [21.00, 12.42], [ 0.00,  2.08], [ 0.00,  1.29], [ 3.50, 10.72], [0.00, 0.33], [ 0.000, 0.04], [ 6.00,  4.55]),
  CB:  makeRef([10.00,  9.84], [20.00, 11.85], [ 1.40,  6.41], [ 2.00, 10.33], [ 8.80,  9.19], [0.00, 1.55], [-0.010, 0.22], [0.00, 1.00]),
  LB:  makeRef([10.00, 10.029], [14.40, 10.815], [ 9.875, 13.265], [ 3.00,  8.823], [12.05,  9.606], [0.00, 1.719], [-0.020, 0.221], [0.00, 1.00]),
  RB:  makeRef([10.00, 10.029], [14.40, 10.815], [ 9.875, 13.265], [ 3.00,  8.823], [12.05,  9.606], [0.00, 1.719], [-0.020, 0.221], [0.00, 1.00]),
  LWB: makeRef([10.00, 10.029], [14.40, 10.815], [ 9.875, 13.265], [ 3.00,  8.823], [12.05,  9.606], [0.00, 1.719], [-0.020, 0.221], [0.00, 1.00]),
  RWB: makeRef([10.00, 10.029], [14.40, 10.815], [ 9.875, 13.265], [ 3.00,  8.823], [12.05,  9.606], [0.00, 1.719], [-0.020, 0.221], [0.00, 1.00]),
  DM:  makeRef([14.00,  6.57], [13.40, 12.96], [10.50, 13.26], [ 2.00,  9.62], [18.30,  7.44], [0.00, 2.06], [-0.025, 0.28], [0.00, 1.00]),
  CM:  makeRef([13.00,  6.71], [12.00, 14.24], [15.00, 15.81], [ 6.00, 11.59], [14.50,  5.60], [0.00, 2.46], [-0.045, 0.32], [0.00, 1.00]),
  AM:  makeRef([12.00,  7.69], [11.20, 19.28], [17.10, 19.55], [12.00, 15.09], [11.50,  5.49], [0.00, 3.40], [-0.065, 0.45], [0.00, 1.00]),
  LW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
  RW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
  ST:  makeRef([ 6.00,  9.21], [ 6.80, 20.62], [ 6.10,  9.30], [19.00, 21.93], [ 9.00,  4.29], [0.00, 3.77], [-0.050, 0.47], [0.00, 1.00])
};

function mapToRawStats(g) {
  return {
    minutes_played: g.minutes,
    goals: g.goals,
    assists: g.assists,
    shots_total: 0,
    shots_on_target: 0,
    passes_total: 0,
    passes_accurate: 0,
    pass_completion_pct: 0,
    key_passes: 0,
    big_chances_created: 0,
    dribbles_attempted: 0,
    dribbles_successful: 0,
    tackles_total: 0,
    tackles_won: 0,
    interceptions: 0,
    clearances: 0,
    blocks: 0,
    saves: 0,
    goals_conceded: g.goals_conceded,
    penalty_saves: 0,
    yellow_cards: g.yellow_cards,
    red_cards: 0,
    own_goals: 0,
    penalties_missed: 0,
    clean_sheet: g.clean_sheet,
    bps: g.bps,
    influence: g.influence,
    creativity: g.creativity,
    threat: g.threat ?? 0,
    ict_index: g.ict_index,
    expected_goals: g.expected_goals,
    expected_assists: g.expected_assists,
    expected_goals_conceded: g.expected_goals_conceded,
    fpl_tackles: g.fpl_tackles,
    fpl_cbi: g.fpl_cbi,
    fpl_recoveries: g.fpl_recoveries,
    fpl_def_contrib: g.fpl_def_contrib
  };
}

let count = 0;
let sumV1 = 0;
let sumStandard = 0;

console.log('GW  Mins     V1 Points  V2 Standard     Delta   Key Stats & Rationale');
console.log('-'.repeat(95));

for (const g of games) {
  const raw = mapToRawStats(g);
  
  // V1 Legacy rating
  const v1Res = calculateMatchRatingV1(raw, 'RB');

  // Standard V2 weights
  POSITION_WEIGHTS.RB = { match_impact: 0.30, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 };
  POSITION_WEIGHTS.LB = POSITION_WEIGHTS.RB;
  const standardRes = calculateMatchRating(raw, 'RB', newFbStats);
  
  const d = standardRes.fantasyPoints - v1Res.fantasyPoints;
  sumV1 += v1Res.fantasyPoints;
  sumStandard += standardRes.fantasyPoints;
  count++;

  let reason = '';
  if (g.goals > 0 || g.assists > 0) {
    reason += `Return (${g.goals}G, ${g.assists}A). `;
  }
  if (g.creativity > 25) {
    reason += `High Creativity (${g.creativity.toFixed(1)}). `;
  }
  if (g.clean_sheet) {
    reason += 'Clean Sheet. ';
  }
  if (g.goals_conceded > 1) {
    reason += `Conceded ${g.goals_conceded}. `;
  }
  if (g.bps > 25) {
    reason += `High BPS (${g.bps}). `;
  }

  console.log(
    `${String(g.gameweek).padStart(2)}  ` +
    `${String(g.minutes).padStart(4)}  ` +
    `${v1Res.fantasyPoints.toFixed(1).padStart(12)}  ` +
    `${standardRes.fantasyPoints.toFixed(1).padStart(11)}  ` +
    `${(d >= 0 ? '+' : '')}${d.toFixed(2).padStart(8)}   ` +
    `${reason}`
  );
}

console.log('-'.repeat(95));
console.log(`Average:         ${(sumV1/count).toFixed(2).padStart(12)}  ${(sumStandard/count).toFixed(2).padStart(11)}  ${((sumStandard - sumV1)/count >= 0 ? '+' : '')}${((sumStandard - sumV1)/count).toFixed(2).padStart(8)}`);
