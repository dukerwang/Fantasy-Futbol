import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ictCoefficients = JSON.parse(readFileSync('./src/lib/scoring/ictImputation.json', 'utf8'));

// Replicate ictFeatures
const NUMERIC_FEATURES = [
  'minutes_played',
  'goals',
  'assists',
  'expected_goals',
  'expected_assists',
  'expected_goals_conceded',
  'saves',
  'bps',
  'fpl_tackles',
  'fpl_cbi',
  'fpl_recoveries',
  'fpl_def_contrib',
  'goals_conceded',
  'yellow_cards',
  'red_cards',
  'own_goals',
  'penalties_missed',
  'penalty_saves',
];

const FEATURE_COUNT = NUMERIC_FEATURES.length + 3;

const POSITION_GROUP = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  DM: 'MID', CM: 'MID', AM: 'MID',
  LW: 'ATT', RW: 'ATT', ST: 'ATT',
};

function extractFeatures(stats) {
  const num = (k) => Number(stats[k]) || 0;
  const f = NUMERIC_FEATURES.map(num);
  f.push(stats.clean_sheet ? 1 : 0);
  f.push(num('minutes_played') / 90);
  f.push(Math.sqrt(Math.max(0, num('bps'))));
  return f;
}

function bucketFor(position) {
  if (ictCoefficients[position]) return position;
  const group = POSITION_GROUP[position];
  if (group && ictCoefficients[group]) return group;
  return ictCoefficients.MID ? 'MID' : Object.keys(ictCoefficients)[0];
}

function imputeIct(stats, position) {
  const bucket = bucketFor(position);
  const model = ictCoefficients[bucket];
  if (!model) return null;

  const x = extractFeatures(stats);
  const out = {};
  for (const target of ['influence', 'creativity', 'threat']) {
    const beta = model[target];
    if (!beta || beta.length !== FEATURE_COUNT + 1) return null;
    let v = beta[FEATURE_COUNT]; // intercept
    for (let i = 0; i < FEATURE_COUNT; i++) v += beta[i] * x[i];
    out[target] = Math.round(Math.max(0, v) * 10) / 10;
  }
  return out;
}

function applyIctImputation(stats, position) {
  if ((Number(stats.minutes_played) || 0) <= 0) return stats;
  const est = imputeIct(stats, position);
  if (!est) return stats;
  return {
    ...stats,
    influence: est.influence,
    creativity: est.creativity,
    threat: est.threat,
    ict_index: Math.round((est.influence + est.creativity + est.threat)) / 10,
    ict_imputed: true,
  };
}

// Replicate scoring engine
const FLEX_CONFIG = {
  GK: { flex: 0.20, components: ['save_score', 'defensive'] },
  CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
  LB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
  RB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  LWB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity', 'threat', 'goal_involvement'] },
  RWB: { flex: 0.25, components: ['defensive', 'match_impact', 'creativity', 'threat', 'goal_involvement'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  LW: { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] },
  RW: { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] },
  ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};

const POSITION_WEIGHTS = {
  GK: { match_impact: 0.14, influence: 0.06, creativity: 0.00, threat: 0.00, defensive: 0.38, goal_involvement: 0.00, finishing: 0.00, save_score: 0.22 },
  CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 },
  LB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  RB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  LWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  RWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  AM: { match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  LW: { match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00 },
  RW: { match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00 },
  ST: { match_impact: 0.15, influence: 0.10, creativity: 0.10, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
};

function getPosGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') return 'DEF';
  if (pos === 'DM' || pos === 'CM' || pos === 'AM') return 'MID';
  return 'ATT';
}

function makeRef(mi, inf, cre, thr, def, gi, fin, sav) {
  return {
    match_impact: { median: mi[0], stddev: mi[1] },
    influence: { median: inf[0], stddev: inf[1] },
    creativity: { median: cre[0], stddev: cre[1] },
    threat: { median: thr[0], stddev: thr[1] },
    defensive: { median: def[0], stddev: def[1] },
    goal_involvement: { median: gi[0], stddev: gi[1] },
    finishing: { median: fin[0], stddev: fin[1] },
    save_score: { median: sav[0], stddev: sav[1] },
  };
}

const DEFAULT_REFERENCE_STATS = {
  GK:  makeRef([12.00, 10.17], [21.00, 12.42], [ 0.00,  2.08], [ 0.00,  1.29], [ 2.950, 16.416], [0.00, 0.33], [ 0.000, 0.04], [ 7.500,  5.429]),
  CB:  makeRef([10.00,  9.84], [20.00, 11.85], [ 1.40,  6.41], [ 2.00, 10.33], [ 8.80,  9.19], [0.00, 1.55], [-0.010, 0.22], [0.00, 1.00]),
  LB:  makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
  RB:  makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
  LWB: makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
  RWB: makeRef([10.00,  9.86], [14.80, 10.64], [ 8.30, 12.79], [ 2.00,  8.82], [12.45,  9.79], [0.00, 1.66], [-0.020, 0.22], [0.00, 1.00]),
  DM:  makeRef([14.00,  6.57], [13.40, 12.96], [10.50, 13.26], [ 2.00,  9.62], [18.30,  7.44], [0.00, 2.06], [-0.025, 0.28], [0.00, 1.00]),
  CM:  makeRef([13.00,  6.71], [12.00, 14.24], [15.00, 15.81], [ 6.00, 11.59], [14.50,  5.60], [0.00, 2.46], [-0.045, 0.32], [0.00, 1.00]),
  AM:  makeRef([12.00,  7.69], [11.20, 19.28], [17.10, 19.55], [12.00, 15.09], [11.50,  5.49], [0.00, 3.40], [-0.065, 0.45], [0.00, 1.00]),
  LW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
  RW:  makeRef([10.00,  7.02], [ 9.60, 16.12], [15.20, 15.29], [14.00, 15.63], [10.60,  4.95], [0.00, 2.91], [-0.065, 0.39], [0.00, 1.00]),
  ST:  makeRef([ 6.00,  9.21], [ 6.80, 20.62], [ 6.10,  9.30], [19.00, 21.93], [ 9.00,  4.29], [0.00, 3.77], [-0.050, 0.47], [0.00, 1.00]),
};

const SIGMOID_K = 1.0;
const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;

function computeZScore(value, median, stddev) {
  if (stddev <= 0) return 0;
  return SIGMOID_K * (value - median) / stddev;
}

function sigmoidNormalize(value, median, stddev) {
  if (stddev <= 0) return 0.5;
  return 1 / (1 + Math.exp(-computeZScore(value, median, stddev)));
}

const GK_CLEAN_SHEET = 20;
const GK_CLEAN_SHEET_SAVE_CAP = 16;
const GK_GOAL_CONCEDED = 3.4;
const GK_XGC_DIFF = 2.5;
const GK_CURVE_SCALE = 0.84;
const FEAT_POINTS_PER_UNIT = 3.0;
const FEAT_GI_SATURATION_RAW = 11.5;
const FEAT_GI_UNIT = 6;
const FEAT_CREATIVITY_RAW = 90;
const FEAT_CREATIVITY_UNIT = 15;

function featExcessFor(stats, position) {
  const posWeights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
  let excess = 0;
  if (posWeights.goal_involvement > 0) {
    const goalInvRaw = Number(stats.goals ?? 0) * 6 + Number(stats.assists ?? 0) * 4;
    excess += Math.max(0, goalInvRaw - FEAT_GI_SATURATION_RAW) / FEAT_GI_UNIT;
  }
  if (posWeights.creativity > 0) {
    excess += Math.max(0, Number(stats.creativity ?? 0) - FEAT_CREATIVITY_RAW) / FEAT_CREATIVITY_UNIT;
  }
  return excess;
}

function featPointsBonus(excess) {
  if (excess <= 0) return 0;
  return FEAT_POINTS_PER_UNIT * excess;
}

function calculateFantasyPoints(rating, minutesPlayed) {
  if (minutesPlayed === 0 || rating === 0) return 0;
  const basePoints = 0.0;
  const scale = 8.6;
  const curve = Math.pow(Math.max(0, rating - 4.0) / 2.0, 1.5);
  const finalPoints = basePoints + (scale * curve);
  return Math.max(0, Number(finalPoints.toFixed(2)));
}

function curveFinalRating(composite, minutesPlayed) {
  if (composite < 0 || minutesPlayed === 0) return 0;
  const rating = 3.5 + 6.0 * composite;
  return Math.max(1.0, Math.min(10.0, rating));
}

function computeScoringRating(composite, minutesPlayed) {
  if (composite < 0 || minutesPlayed === 0) return 0;
  const r = 1.0 + 9.0 * composite;
  return Math.max(1.0, Math.min(10.0, r));
}

function computeComponentScores(stats, position, refStats, primaryPosition) {
  const ref = refStats[position] || refStats.CM;

  const rawBps = stats.bps ?? 0;
  const goalAssistBps = (stats.goals ?? 0) * 12 + (stats.assists ?? 0) * 9;
  const adjustedBps = Math.max(0, rawBps - goalAssistBps);

  const matchImpact = {
    score: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
    detail: `BPS: ${rawBps} (adj: ${adjustedBps})`,
  };

  const infl = stats.influence ?? 0;
  const influence = {
    score: sigmoidNormalize(infl, ref.influence.median, ref.influence.stddev),
    detail: `${infl.toFixed(1)}`,
  };

  const crea = stats.creativity ?? 0;
  const creativity = {
    score: sigmoidNormalize(crea, ref.creativity.median, ref.creativity.stddev),
    detail: `${crea.toFixed(1)}`,
  };

  const thr = stats.threat ?? 0;
  const threat = {
    score: sigmoidNormalize(thr, ref.threat.median, ref.threat.stddev),
    detail: `${thr.toFixed(1)}`,
  };

  const gc = stats.goals_conceded ?? 0;
  const xgc = stats.expected_goals_conceded ?? 0;
  const posGroup = getPosGroup(position);
  let csBonus = 0;
  if (stats.clean_sheet && (stats.minutes_played ?? 0) >= 60) {
    let baseCs = 0;
    if (position === 'GK') baseCs = 16;
    else if (posGroup === 'DEF' || position === 'DM') baseCs = 12;
    else if (position === 'CM') baseCs = 4;

    if (primaryPosition && primaryPosition === 'AM' && ['CB', 'LB', 'RB'].includes(position)) {
      csBonus = 0;
    } else {
      csBonus = baseCs;
    }
  }
  const canGetCS = csBonus > 0;
  const xgcOutperf = Math.max(0, xgc - gc) * 5;
  const gcPenalty = Math.max(0, gc - xgc) * 5;

  const tackles = Math.max(0, stats.fpl_tackles ?? 0);
  const cbi = Math.max(0, stats.fpl_cbi ?? 0);
  const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);

  let defActionsRaw;
  if (position === 'GK') {
    defActionsRaw = recoveries * 0.4;
  } else if (position === 'CB') {
    defActionsRaw = tackles + cbi * 0.5;
  } else {
    defActionsRaw = (tackles + cbi) + recoveries * 0.5;
  }

  let defensiveRaw;
  if (position === 'GK') {
    let gkCsVal = 0;
    const sv = Math.max(0, stats.saves ?? 0);
    if (stats.clean_sheet && canGetCS) {
      gkCsVal = GK_CLEAN_SHEET + Math.min(GK_CLEAN_SHEET_SAVE_CAP, sv * 1.0);
    }
    const xgcDiff = Math.max(-2.5, Math.min(2.5, xgc - gc));
    let zeroSavePenalty = 0;
    if (!stats.clean_sheet && sv === 0 && gc >= 1) {
      zeroSavePenalty = 4.5 * gc;
    }
    defensiveRaw = defActionsRaw + gkCsVal - gc * GK_GOAL_CONCEDED + xgcDiff * GK_XGC_DIFF - zeroSavePenalty;
  } else {
    defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;
  }

  const defensive = {
    score: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
  };

  const g = stats.goals ?? 0;
  const a = stats.assists ?? 0;
  const goalInvRaw = g * 6 + a * 4;
  const goalInvolvement = {
    score: sigmoidNormalize(goalInvRaw, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
  };

  const xg = stats.expected_goals ?? 0;
  const xa = stats.expected_assists ?? 0;
  const xgOutperf = g - xg;
  const xaOutperf = a - xa;
  const finInput = xgOutperf + (xaOutperf * 0.5);
  const finishing = {
    score: sigmoidNormalize(finInput, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
  };

  let saveScore;
  if (position === 'GK') {
    const sv = Math.max(0, stats.saves ?? 0);
    const psav = Math.max(0, stats.penalty_saves ?? 0);
    const shotsFaced = sv + gc;
    let matchSavePct = 0.70;
    if (shotsFaced > 0) matchSavePct = sv / shotsFaced;
    else if (stats.clean_sheet && canGetCS) matchSavePct = 1.0;

    const saveVolRaw = sv * 2.5 + psav * 6;
    const saveVolScore = sigmoidNormalize(saveVolRaw, ref.save_score.median, ref.save_score.stddev);
    const savePctScore = sigmoidNormalize(matchSavePct, 0.70, 0.15);
    const scoreVal = saveVolScore * 0.45 + savePctScore * 0.55;
    saveScore = { score: scoreVal };
  } else {
    saveScore = { score: 0.5 };
  }

  return {
    match_impact: matchImpact,
    influence,
    creativity,
    threat,
    defensive,
    goal_involvement: goalInvolvement,
    finishing,
    save_score: saveScore,
  };
}

function applyPositionWeights(scores, position) {
  const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
  const flexConfig = FLEX_CONFIG[position] || FLEX_CONFIG.CM;

  let maxScore = -1;
  let maxComponent = '';

  for (const key of flexConfig.components) {
    if (scores[key].score > maxScore) {
      maxScore = scores[key].score;
      maxComponent = key;
    }
  }

  let composite = 0;
  const breakdown = [];

  for (const key of Object.keys(weights)) {
    const weight = weights[key];
    let finalWeight = weight;
    if (key === maxComponent) finalWeight += flexConfig.flex;
    if (finalWeight === 0) continue;

    const score = scores[key].score;
    const weighted = score * finalWeight;
    composite += weighted;

    breakdown.push({ key, score, weight: finalWeight, weighted });
  }

  return { composite: Math.min(1.0, composite), breakdown, maxComponent };
}

function calculateMatchRating(stats, position, refStats, primaryPosition) {
  if ((stats.minutes_played ?? 0) === 0) {
    return { rating: 0, fantasyPoints: 0, position, composite: 0, breakdown: [] };
  }

  const components = computeComponentScores(stats, position, refStats, primaryPosition);
  const { composite, breakdown, maxComponent } = applyPositionWeights(components, position);
  const featExcess = featExcessFor(stats, position);
  const rating = curveFinalRating(composite, stats.minutes_played);
  const scoringRating = computeScoringRating(composite, stats.minutes_played);
  let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);

  if (position === 'GK') fantasyPoints *= GK_CURVE_SCALE;
  fantasyPoints += featPointsBonus(featExcess);

  return {
    rating: Number(rating.toFixed(2)),
    fantasyPoints: Number(fantasyPoints.toFixed(2)),
    composite,
    breakdown,
    maxComponent,
    components,
    featExcess,
  };
}

async function run() {
  const { data: dbRows } = await admin
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', '2025-26');

  const refStats = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  if (dbRows && dbRows.length > 0) {
    for (const row of dbRows) {
      const pos = row.position_group;
      const comp = row.component;
      if (refStats[pos] && refStats[pos][comp]) {
        refStats[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
      }
    }
  }

  const { data: matchup } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('id', 'b1f0be6c-c9ab-4250-b13b-36623408530b')
    .single();

  const allPlayerIds = [
    ...matchup.lineup_a.starters.map(s => s.player_id),
    ...matchup.lineup_a.bench.map(s => s.player_id),
    ...matchup.lineup_b.starters.map(s => s.player_id),
    ...matchup.lineup_b.bench.map(s => s.player_id),
  ];

  const { data: players } = await admin
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team')
    .in('id', allPlayerIds);

  const playerMap = new Map(players.map((p) => [p.id, p]));

  const { data: statsGW2 } = await admin
    .from('player_stats')
    .select('*')
    .eq('gameweek', 2)
    .in('player_id', allPlayerIds);

  const statsMap = new Map(statsGW2.map((s) => [s.player_id, s]));

  const MID_OR_ATT = ['DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
  const DEFENSIVE_SLOTS = ['CB', 'LB', 'RB', 'LWB', 'RWB'];

  function analyzeLineup(teamName, lineup) {
    console.log(`\n======================================================`);
    console.log(`TEAM: ${teamName}`);
    console.log(`======================================================`);
    let totalLiveImputedScore = 0;
    let totalFinalActualScore = 0;
    let totalZeroScore = 0;

    console.log('--- STARTERS ---');
    for (const s of lineup.starters) {
      const p = playerMap.get(s.player_id);
      const row = statsMap.get(s.player_id);
      const stats = row?.stats || {};
      const pos = s.slot;
      const primaryPos = p?.primary_position;

      // 1. Final result
      const finalRes = calculateMatchRating(stats, pos, refStats, primaryPos);

      // 2. Imputed result (simulate live window where influence/creativity/threat are imputed)
      const impStats = applyIctImputation({ ...stats }, primaryPos);
      const impRes = calculateMatchRating(impStats, pos, refStats, primaryPos);

      // 3. Zeroed result (if ICT had been 0.0)
      const zeroStats = { ...stats, influence: 0, creativity: 0, threat: 0, ict_index: 0 };
      const zeroRes = calculateMatchRating(zeroStats, pos, refStats, primaryPos);

      let finalPts = finalRes.fantasyPoints;
      let impPts = impRes.fantasyPoints;
      let zeroPts = zeroRes.fantasyPoints;

      // Check OOP penalty
      if (primaryPos && MID_OR_ATT.includes(primaryPos) && DEFENSIVE_SLOTS.includes(pos)) {
        finalPts *= 0.80;
        impPts *= 0.80;
        zeroPts *= 0.80;
      }

      totalLiveImputedScore += impPts;
      totalFinalActualScore += finalPts;
      totalZeroScore += zeroPts;

      const dPts = finalPts - impPts;
      const dRating = finalRes.rating - impRes.rating;

      console.log(`\n[Slot ${s.slot}] ${p?.web_name || p?.name} (${primaryPos} -> playing ${s.slot}, ${p?.pl_team}) | Min: ${stats.minutes_played || 0}`);
      console.log(`  Actual FPL:  Inf: ${Number(stats.influence||0).toFixed(1)}, Cre: ${Number(stats.creativity||0).toFixed(1)}, Thr: ${Number(stats.threat||0).toFixed(1)}, BPS: ${stats.bps||0}, G: ${stats.goals||0}, A: ${stats.assists||0}, CS: ${stats.clean_sheet ? 1 : 0}, GC: ${stats.goals_conceded||0}`);
      console.log(`  Imputed:     Inf: ${Number(impStats.influence||0).toFixed(1)}, Cre: ${Number(impStats.creativity||0).toFixed(1)}, Thr: ${Number(impStats.threat||0).toFixed(1)}`);
      console.log(`  Δ ICT:       ΔInf: ${(Number(stats.influence||0) - Number(impStats.influence||0)).toFixed(1)}, ΔCre: ${(Number(stats.creativity||0) - Number(impStats.creativity||0)).toFixed(1)}, ΔThr: ${(Number(stats.threat||0) - Number(impStats.threat||0)).toFixed(1)}`);
      console.log(`  Scores:`);
      console.log(`    Live (Imputed): Rating ${impRes.rating.toFixed(2)} | Pts: ${impPts.toFixed(2)}`);
      console.log(`    Final (Actual):  Rating ${finalRes.rating.toFixed(2)} | Pts: ${finalPts.toFixed(2)} (DB stored: ${row?.fantasy_points})`);
      console.log(`    Zeroed (No Imp): Rating ${zeroRes.rating.toFixed(2)} | Pts: ${zeroPts.toFixed(2)}`);
      console.log(`    >>> DELTA: ${dPts >= 0 ? '+' : ''}${dPts.toFixed(2)} pts (Rating Δ: ${dRating >= 0 ? '+' : ''}${dRating.toFixed(2)})`);
    }

    console.log('\n--- BENCH DEPTH BONUS (25% of played bench) ---');
    for (const b of lineup.bench) {
      const p = playerMap.get(b.player_id);
      const row = statsMap.get(b.player_id);
      const stats = row?.stats || {};
      const primaryPos = p?.primary_position;

      const finalRes = calculateMatchRating(stats, primaryPos, refStats, primaryPos);
      const impStats = applyIctImputation({ ...stats }, primaryPos);
      const impRes = calculateMatchRating(impStats, primaryPos, refStats, primaryPos);
      const zeroStats = { ...stats, influence: 0, creativity: 0, threat: 0, ict_index: 0 };
      const zeroRes = calculateMatchRating(zeroStats, primaryPos, refStats, primaryPos);

      const min = stats.minutes_played || 0;
      if (min > 0) {
        const finalBenchPts = finalRes.fantasyPoints * 0.25;
        const impBenchPts = impRes.fantasyPoints * 0.25;
        const zeroBenchPts = zeroRes.fantasyPoints * 0.25;

        totalLiveImputedScore += impBenchPts;
        totalFinalActualScore += finalBenchPts;
        totalZeroScore += zeroBenchPts;

        console.log(`[Bench ${b.slot}] ${p?.web_name || p?.name} (${primaryPos}) - Min: ${min} | Live Pts: ${impBenchPts.toFixed(2)} | Final Pts: ${finalBenchPts.toFixed(2)} (Δ ${(finalBenchPts - impBenchPts).toFixed(2)})`);
      } else {
        console.log(`[Bench ${b.slot}] ${p?.web_name || p?.name} (${primaryPos}) - Min: 0 (Did not play)`);
      }
    }

    console.log(`\n>>> ${teamName} TOTAL MATCH SCORE:`);
    console.log(`    Live (Imputed): ${totalLiveImputedScore.toFixed(2)}`);
    console.log(`    Final (Actual):  ${totalFinalActualScore.toFixed(2)}`);
    console.log(`    Zeroed (No Imp): ${totalZeroScore.toFixed(2)}`);
    console.log(`    Net Δ (Final - Live): ${(totalFinalActualScore - totalLiveImputedScore).toFixed(2)} pts`);

    return { totalLiveImputedScore, totalFinalActualScore, totalZeroScore };
  }

  const teamA = analyzeLineup(matchup.team_a.team_name, matchup.lineup_a);
  const teamB = analyzeLineup(matchup.team_b.team_name, matchup.lineup_b);

  console.log(`\n======================================================`);
  console.log(`MATCHUP SUMMARY COMPARISON`);
  console.log(`======================================================`);
  console.log(`DB Stored Final Score: ${matchup.team_a.team_name} ${matchup.score_a} - ${matchup.score_b} ${matchup.team_b.team_name}`);
  console.log(`Calculated Final Score: ${matchup.team_a.team_name} ${teamA.totalFinalActualScore.toFixed(2)} - ${teamB.totalFinalActualScore.toFixed(2)} ${matchup.team_b.team_name}`);
  console.log(`Live Imputed Score:     ${matchup.team_a.team_name} ${teamA.totalLiveImputedScore.toFixed(2)} - ${teamB.totalLiveImputedScore.toFixed(2)} ${matchup.team_b.team_name}`);
  console.log(`\nPre-finalization margin: ${(teamA.totalLiveImputedScore - teamB.totalLiveImputedScore).toFixed(2)} (Hayden FC leading by ${Math.abs(teamA.totalLiveImputedScore - teamB.totalLiveImputedScore).toFixed(2)})`);
  console.log(`Post-finalization margin: ${(teamB.totalFinalActualScore - teamA.totalFinalActualScore).toFixed(2)} (Not Too Xabi winning by ${(teamB.totalFinalActualScore - teamA.totalFinalActualScore).toFixed(2)})`);
  console.log(`Total Swing: ${((teamB.totalFinalActualScore - teamB.totalLiveImputedScore) - (teamA.totalFinalActualScore - teamA.totalLiveImputedScore)).toFixed(2)} pts`);
}

run().catch(console.error);
