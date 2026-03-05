/**
 * calc_season_leaderboard.js
 *
 * Fetches FPL live stats for every completed GW of the 25/26 season,
 * runs the Fantasy Futbol match-rating algorithm (matching the edge function
 * sync-ratings/index.ts exactly), and prints a leaderboard.
 *
 * Usage:  node scripts/calc_season_leaderboard.js
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

// ── Load .env.local ───────────────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const FPL_BASE = 'https://fantasy.premierleague.com/api';

// ═══════════════════════════════════════════════════════════════════════════
// Match Rating Algorithm — ported from supabase/functions/sync-ratings/index.ts
// MUST stay in sync with that file.
// ═══════════════════════════════════════════════════════════════════════════

const SIGMOID_K = 1.0;

function sigmoidNormalize(value, median, stddev) {
  if (stddev <= 0) return 0.5;
  const z = SIGMOID_K * (value - median) / stddev;
  return 1 / (1 + Math.exp(-z));
}

const FLEX_CONFIG = {
  GK: { flex: 0.20, components: ['save_score', 'defensive'] },
  CB: { flex: 0.25, components: ['defensive', 'match_impact', 'influence'] },
  LB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
  RB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'goal_involvement'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  LM: { flex: 0.10, components: ['creativity', 'goal_involvement', 'influence'] },
  RM: { flex: 0.10, components: ['creativity', 'goal_involvement', 'influence'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  LW: { flex: 0.10, components: ['threat', 'goal_involvement', 'finishing'] },
  RW: { flex: 0.15, components: ['threat', 'goal_involvement', 'finishing'] },
  ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
};

//                                                                                                                        Σ = 1.00
const POSITION_WEIGHTS = {
  GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
  CB: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.15, finishing: 0.05, save_score: 0.00 },
  LB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  RB: { match_impact: 0.20, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  LM: { match_impact: 0.15, influence: 0.15, creativity: 0.10, threat: 0.10, defensive: 0.15, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  RM: { match_impact: 0.15, influence: 0.15, creativity: 0.10, threat: 0.10, defensive: 0.15, goal_involvement: 0.10, finishing: 0.05, save_score: 0.00 },
  AM: { match_impact: 0.15, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.20, finishing: 0.15, save_score: 0.00 }, // Bruno tune
  LW: { match_impact: 0.15, influence: 0.15, creativity: 0.05, threat: 0.15, defensive: 0.05, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
  RW: { match_impact: 0.15, influence: 0.00, creativity: 0.05, threat: 0.25, defensive: 0.05, goal_involvement: 0.35, finishing: 0.15, save_score: 0.00 },
  ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.30, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }, // Haaland buff
};

function getPositionGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DEF';
  if (pos === 'DM' || pos === 'CM' || pos === 'LM' || pos === 'RM' || pos === 'AM') return 'MID';
  return 'ATT'; // LW, RW, ST
}

// Default reference stats — granular per-position (synced with matchRating.ts DEFAULT_REFERENCE_STATS)
// match_control calibrated for FPL proxy: (influence * 1.5) + (bps * 1.0)
const DEFAULT_REF = {
  GK: { match_impact: { median: 10.0, stddev: 9.83 }, influence: { median: 23.0, stddev: 14.13 }, creativity: { median: 0.0, stddev: 2.34 }, threat: { median: 0.0, stddev: 0.94 }, defensive: { median: 0.08, stddev: 2.78 }, goal_involvement: { median: 0.0, stddev: 0.49 }, finishing: { median: 0.0, stddev: 0.10 }, save_score: { median: 4.0, stddev: 4.46 } },
  CB: { match_impact: { median: 9.0, stddev: 9.46 }, influence: { median: 18.8, stddev: 11.30 }, creativity: { median: 1.9, stddev: 11.30 }, threat: { median: 2.0, stddev: 10.24 }, defensive: { median: 0.08, stddev: 2.75 }, goal_involvement: { median: 0.0, stddev: 1.50 }, finishing: { median: 0.0, stddev: 0.19 }, save_score: { median: 0.0, stddev: 1.0 } },
  LB: { match_impact: { median: 10.0, stddev: 9.54 }, influence: { median: 16.8, stddev: 11.90 }, creativity: { median: 12.6, stddev: 13.58 }, threat: { median: 4.0, stddev: 9.35 }, defensive: { median: 0.16, stddev: 2.78 }, goal_involvement: { median: 0.0, stddev: 1.97 }, finishing: { median: 0.0, stddev: 0.20 }, save_score: { median: 0.0, stddev: 1.0 } },
  RB: { match_impact: { median: 9.0, stddev: 9.80 }, influence: { median: 15.0, stddev: 10.22 }, creativity: { median: 7.65, stddev: 11.42 }, threat: { median: 2.0, stddev: 7.59 }, defensive: { median: 0.25, stddev: 2.69 }, goal_involvement: { median: 0.0, stddev: 1.54 }, finishing: { median: 0.0, stddev: 0.17 }, save_score: { median: 0.0, stddev: 1.0 } },
  DM: { match_impact: { median: 13.0, stddev: 5.98 }, influence: { median: 13.4, stddev: 12.54 }, creativity: { median: 11.25, stddev: 13.38 }, threat: { median: 3.0, stddev: 11.17 }, defensive: { median: 0.22, stddev: 2.83 }, goal_involvement: { median: 0.0, stddev: 2.03 }, finishing: { median: 0.0, stddev: 0.24 }, save_score: { median: 0.0, stddev: 1.0 } },
  CM: { match_impact: { median: 12.0, stddev: 6.61 }, influence: { median: 12.2, stddev: 13.75 }, creativity: { median: 14.1, stddev: 16.46 }, threat: { median: 7.0, stddev: 13.63 }, defensive: { median: 0.18, stddev: 2.81 }, goal_involvement: { median: 0.0, stddev: 2.41 }, finishing: { median: -0.02, stddev: 0.29 }, save_score: { median: 0.0, stddev: 1.0 } },
  LM: { match_impact: { median: 13.0, stddev: 7.09 }, influence: { median: 12.3, stddev: 18.69 }, creativity: { median: 19.5, stddev: 17.12 }, threat: { median: 17.5, stddev: 17.42 }, defensive: { median: 0.02, stddev: 2.71 }, goal_involvement: { median: 0.0, stddev: 3.50 }, finishing: { median: -0.05, stddev: 0.42 }, save_score: { median: 0.0, stddev: 1.0 } },
  RM: { match_impact: { median: 11.0, stddev: 8.25 }, influence: { median: 13.8, stddev: 21.53 }, creativity: { median: 17.3, stddev: 17.62 }, threat: { median: 23.0, stddev: 22.53 }, defensive: { median: 0.58, stddev: 2.80 }, goal_involvement: { median: 0.0, stddev: 3.96 }, finishing: { median: -0.04, stddev: 0.41 }, save_score: { median: 0.0, stddev: 1.0 } },
  AM: { match_impact: { median: 13.0, stddev: 8.13 }, influence: { median: 15.4, stddev: 20.50 }, creativity: { median: 22.3, stddev: 18.69 }, threat: { median: 16.0, stddev: 16.94 }, defensive: { median: 0.46, stddev: 2.84 }, goal_involvement: { median: 0.0, stddev: 3.93 }, finishing: { median: -0.05, stddev: 0.41 }, save_score: { median: 0.0, stddev: 1.0 } },
  LW: { match_impact: { median: 11.0, stddev: 7.12 }, influence: { median: 12.5, stddev: 17.87 }, creativity: { median: 17.8, stddev: 14.98 }, threat: { median: 20.0, stddev: 17.20 }, defensive: { median: 0.32, stddev: 2.90 }, goal_involvement: { median: 0.0, stddev: 3.43 }, finishing: { median: -0.05, stddev: 0.41 }, save_score: { median: 0.0, stddev: 1.0 } },
  RW: { match_impact: { median: 11.0, stddev: 8.16 }, influence: { median: 13.4, stddev: 21.90 }, creativity: { median: 17.75, stddev: 17.10 }, threat: { median: 23.0, stddev: 21.56 }, defensive: { median: 0.13, stddev: 2.81 }, goal_involvement: { median: 0.0, stddev: 4.05 }, finishing: { median: -0.08, stddev: 0.46 }, save_score: { median: 0.0, stddev: 1.0 } },
  ST: { match_impact: { median: 8.0, stddev: 9.87 }, influence: { median: 10.6, stddev: 20.40 }, creativity: { median: 8.3, stddev: 10.55 }, threat: { median: 21.0, stddev: 21.95 }, defensive: { median: 0.16, stddev: 2.82 }, goal_involvement: { median: 0.0, stddev: 3.83 }, finishing: { median: -0.04, stddev: 0.45 }, save_score: { median: 0.0, stddev: 1.0 } },
};

/**
 * computeMatchRating — matches calculateMatchRating() in sync-ratings/index.ts exactly.
 * @param {object} stats - raw stats object (including fpl_tackles, fpl_cbi, fpl_recoveries)
 * @param {string} position - granular position (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST)
 * @param {object} refStats - per-position reference stats (from DB or DEFAULT_REF)
 */
function computeMatchRating(stats, position, refStats) {
  if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

  const posGroup = getPositionGroup(position);
  // Granular first, fall back to position group (matches edge function)
  const ref = refStats[position] ?? refStats[posGroup];

  // 1. Match Impact (BPS adjusted)
  const rawBps = stats.bps ?? 0;
  const adjustedBps = Math.max(0, rawBps - stats.goals * 12 - stats.assists * 9);
  const matchImpactScore = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);

  // 2. Influence
  const inflScore = sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);

  // 3. Creativity
  const creaScore = sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);

  // 4. Threat
  const thrScore = sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev);

  // 5. Defensive (tackle curve + CB CBI nerf + recoveries)
  const gc = stats.goals_conceded;
  const xgc = stats.expected_goals_conceded ?? 0;
  const csBonus = (stats.clean_sheet && stats.minutes_played >= 60) ? 12 : 0;
  const xgcOutperf = Math.max(0, xgc - gc) * 5;
  const gcPenalty = Math.max(0, gc - xgc) * 5;
  const tackleCurve = Math.pow(Math.max(0, stats.fpl_tackles ?? 0), 0.8) * 1.5;
  const recoveriesCurve = Math.pow(Math.max(0, stats.fpl_recoveries ?? 0), 0.7) * 0.8;
  const cbiCurve = position === 'CB'
    ? Math.pow(Math.max(0, stats.fpl_cbi ?? 0), 0.6) * 1.2
    : Math.pow(Math.max(0, stats.fpl_cbi ?? 0), 0.8) * 1.2;
  const defActionsRaw = tackleCurve + cbiCurve + recoveriesCurve;
  const bypassPenalty = (stats.dribbled_past ?? 0) * 2.0;
  const defScore = sigmoidNormalize(defActionsRaw + csBonus + xgcOutperf - gcPenalty - bypassPenalty, ref.defensive.median, ref.defensive.stddev);
  // 6. Goal Involvement
  const g = stats.goals;
  const a = stats.assists;
  const giScore = sigmoidNormalize(g * 6 + a * 4, ref.goal_involvement.median, ref.goal_involvement.stddev);

  // 7. Finishing (clamped linear)
  const xgOut = g - (stats.expected_goals ?? 0);
  const xaOut = a - (stats.expected_assists ?? 0);
  const finScore = Math.max(0, Math.min(1, 0.5 + xgOut * 0.3 + xaOut * 0.15));

  // 8. Save Score (GK only)
  let savScore = 0.5;
  if (posGroup === 'GK') {
    const saveRaw = stats.saves * 2 + stats.penalty_saves * 5 - Math.max(0, gc - xgc) * 2;
    savScore = sigmoidNormalize(saveRaw, ref.save_score.median, ref.save_score.stddev);
  }

  const scores = {
    match_impact: matchImpactScore,
    influence: inflScore,
    creativity: creaScore,
    threat: thrScore,
    defensive: defScore,

    goal_involvement: giScore,
    finishing: finScore,
    save_score: savScore,
  };

  // Weighted composite
  const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
  const flexConfig = FLEX_CONFIG[position] || FLEX_CONFIG.CM;
  let composite = 0;

  let maxScore = -1;
  let maxComponent = '';
  for (const key of flexConfig.components) {
    if (scores[key] > maxScore) {
      maxScore = scores[key];
      maxComponent = key;
    }
  }

  for (const [key, weight] of Object.entries(weights)) {
    let w = weight;
    if (key === maxComponent) w += flexConfig.flex;

    if (w === 0) continue;

    composite += scores[key] * w;
  }

  composite = Math.min(1.0, Math.max(0, composite));

  // Linear map → 1.0–10.0 + minutes penalty
  let rating = 1.0 + 9.0 * composite;
  if (stats.minutes_played < 60) {
    rating = Math.max(1.0, rating - (1 - stats.minutes_played / 60) * 1.5);
  }
  rating = Math.max(1.0, Math.min(10.0, rating));

  // Curve → fantasy points
  const basePoints = 4.0;
  const scale = 5.0;
  const minutePenalty = stats.minutes_played < 60 ? 1.0 : 0;

  const curveRaw = Math.pow(Math.max(0, rating - 4.0) / 2.0, 1.5);
  let fp = basePoints + (scale * curveRaw) - minutePenalty;

  if (rating < 3.0) {
    fp -= 2.0;
  }
  fp = Math.max(0, fp);

  return {
    rating: Math.round(rating * 100) / 100,
    fantasyPoints: Math.round(fp * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Position mapping helpers
// ═══════════════════════════════════════════════════════════════════════════

function fplTypeToBroad(elementType) {
  switch (elementType) {
    case 1: return 'GK';
    case 2: return 'DEF';
    case 3: return 'MID';
    case 4: return 'FWD';
    default: return 'MID';
  }
}

function broadToGranular(broad) {
  switch (broad) {
    case 'GK': return 'GK';
    case 'DEF': return 'CB';
    case 'MID': return 'CM';
    case 'FWD': return 'ST';
    default: return 'CM';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP helpers
// ═══════════════════════════════════════════════════════════════════════════

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function supabaseGet(path) {
  return fetchJson(`${SUPABASE_URL}/rest/v1/${path}`, {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Load reference stats from DB (rating_reference_stats table)
// Falls back to DEFAULT_REF if table is empty / unavailable
// ═══════════════════════════════════════════════════════════════════════════

async function loadReferenceStats(season) {
  try {
    // URL-encode the query params to avoid parse errors with special chars
    const params = new URLSearchParams({
      select: 'position_group,component,median,stddev',
      season: `eq.${season}`,
    });
    const rows = await supabaseGet(`rating_reference_stats?${params}`);

    if (!rows || rows.length === 0) {
      console.log('  No DB reference stats found — using DEFAULT_REF');
      return JSON.parse(JSON.stringify(DEFAULT_REF)); // deep clone
    }

    // Start from defaults, overlay DB values
    const ref = JSON.parse(JSON.stringify(DEFAULT_REF));
    for (const row of rows) {
      const pos = row.position_group;
      const comp = row.component;
      if (ref[pos] && ref[pos][comp]) {
        ref[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
      }
    }
    console.log(`  Loaded ${rows.length} DB reference stat rows (season ${season})`);
    return ref;
  } catch (err) {
    console.warn(`  Warning: could not load DB ref stats (${err.message}) — using DEFAULT_REF`);
    return JSON.parse(JSON.stringify(DEFAULT_REF));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('Fantasy Futbol — 25/26 Season Leaderboard Calculator');
  console.log('  (Algorithm matches supabase/functions/sync-ratings/index.ts)');
  console.log('═'.repeat(60));

  // 1. FPL bootstrap
  console.log('\n[1/5] Fetching FPL bootstrap...');
  const bootstrap = await fetchJson(`${FPL_BASE}/bootstrap-static/`, {
    'User-Agent': 'FantasyFutbol/1.0',
  });

  const fplPlayers = new Map();
  for (const el of bootstrap.elements) {
    fplPlayers.set(el.id, {
      name: el.second_name ? `${el.first_name} ${el.second_name}` : el.web_name,
      web_name: el.web_name,
      team: bootstrap.teams.find(t => t.id === el.team)?.short_name ?? '???',
      broadPosition: fplTypeToBroad(el.element_type),
    });
  }

  const finishedGWs = bootstrap.events
    .filter(e => e.finished)
    .map(e => e.id);

  const currentGW = bootstrap.events.find(e => e.is_current)?.id ?? Math.max(...finishedGWs);
  console.log(`  ${fplPlayers.size} players loaded`);
  console.log(`  Finished GWs: ${finishedGWs.length} (GW1–GW${Math.max(...finishedGWs)})`);
  console.log(`  Current GW: ${currentGW}`);

  // 2. Load reference stats from DB
  console.log('\n[2/5] Loading reference stats from DB...');
  const refStats = await loadReferenceStats('2025-26');

  // 3. Fetch granular positions from Supabase
  console.log('\n[3/5] Fetching granular positions from Supabase...');
  const fplIdToGranular = new Map();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: 'fpl_id,primary_position',
      limit: '1000',
      offset: String(offset),
    });
    // filter: fpl_id=not.is.null
    const batch = await supabaseGet(`players?${params}&fpl_id=not.is.null`);
    for (const p of batch) {
      if (p.fpl_id && p.primary_position) {
        fplIdToGranular.set(p.fpl_id, p.primary_position);
      }
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }

  console.log(`  ${fplIdToGranular.size} players matched to granular positions`);

  // 4. Fetch live data for each finished GW and calculate points
  console.log(`\n[4/5] Processing ${finishedGWs.length} gameweeks...`);

  const playerTotals = new Map();
  let dbMatched = 0;
  let dbFallback = 0;

  for (const gw of finishedGWs) {
    process.stdout.write(`  GW${String(gw).padStart(2, '0')}... `);

    let gwData;
    try {
      gwData = await fetchJson(`${FPL_BASE}/event/${gw}/live/`, {
        'User-Agent': 'FantasyFutbol/1.0',
      });
    } catch (err) {
      console.log(`SKIP (${err.message})`);
      continue;
    }

    const elements = gwData.elements ?? [];
    let gwPlayers = 0;

    for (const el of elements) {
      const s = el.stats;
      if (s.minutes === 0) continue;

      const fplInfo = fplPlayers.get(el.id);
      if (!fplInfo) continue;

      // Determine position
      let granularPos = fplIdToGranular.get(el.id);
      if (granularPos) {
        dbMatched++;
      } else {
        granularPos = broadToGranular(fplInfo.broadPosition);
        dbFallback++;
      }

      // Map FPL live stats → RawStats (matches mapFplToRawStats in edge function)
      const stats = {
        minutes_played: s.minutes,
        goals: s.goals_scored,
        assists: s.assists,
        saves: s.saves,
        goals_conceded: s.goals_conceded,
        penalty_saves: s.penalties_saved,
        yellow_cards: s.yellow_cards,
        red_cards: s.red_cards,
        own_goals: s.own_goals,
        penalties_missed: s.penalties_missed,
        clean_sheet: s.clean_sheets > 0,
        bps: s.bps,
        influence: parseFloat(s.influence) || 0,
        creativity: parseFloat(s.creativity) || 0,
        threat: parseFloat(s.threat) || 0,
        ict_index: parseFloat(s.ict_index) || 0,
        expected_goals: parseFloat(s.expected_goals) || 0,
        expected_assists: parseFloat(s.expected_assists) || 0,
        expected_goals_conceded: parseFloat(s.expected_goals_conceded) || 0,
        // Granular defensive stats
        fpl_tackles: s.tackles ?? 0,
        fpl_cbi: s.clearances_blocks_interceptions ?? 0,
        fpl_recoveries: s.recoveries ?? 0,
      };

      const { rating, fantasyPoints } = computeMatchRating(stats, granularPos, refStats);

      // Accumulate
      if (!playerTotals.has(el.id)) {
        playerTotals.set(el.id, {
          fplId: el.id,
          name: fplInfo.web_name,
          team: fplInfo.team,
          position: granularPos,
          broadPos: fplInfo.broadPosition,
          totalPoints: 0,
          totalRating: 0,
          gamesPlayed: 0,
          goals: 0,
          assists: 0,
          minutesPlayed: 0,
          bestGWPoints: 0,
          bestGW: 0,
          gwBreakdown: [],
        });
      }

      const acc = playerTotals.get(el.id);
      acc.totalPoints += fantasyPoints;
      acc.totalRating += rating;
      acc.gamesPlayed += 1;
      acc.goals += s.goals_scored;
      acc.assists += s.assists;
      acc.minutesPlayed += s.minutes;
      if (fantasyPoints > acc.bestGWPoints) {
        acc.bestGWPoints = fantasyPoints;
        acc.bestGW = gw;
      }
      acc.gwBreakdown.push({ gw, points: fantasyPoints, rating });
      gwPlayers++;
    }

    console.log(`${gwPlayers} players`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n  Position resolution: ${dbMatched} from DB, ${dbFallback} fallback`);

  // 5. Print leaderboard
  console.log('\n[5/5] Generating leaderboard...\n');

  const sorted = Array.from(playerTotals.values())
    .filter(p => p.gamesPlayed >= 1)
    .sort((a, b) => b.totalPoints - a.totalPoints);

  const TOP_N = sorted.length;

  // ── Overall full list ───────────────────────────────────────────────────
  console.log('═'.repeat(90));
  console.log(`  TOP ${TOP_N} PLAYERS — 25/26 SEASON (GW1–GW${Math.max(...finishedGWs)}) — Fantasy Futbol Points`);
  console.log('═'.repeat(90));
  console.log(
    'Rank  Player              Team  Pos    GP    Pts     Avg    Rating  Goals  Ast  Best GW'
  );
  console.log('─'.repeat(90));

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const avgPts = (p.totalPoints / p.gamesPlayed).toFixed(1);
    const avgRating = (p.totalRating / p.gamesPlayed).toFixed(1);
    console.log(
      `${String(i + 1).padStart(4)}  ` +
      `${p.name.padEnd(20)}` +
      `${p.team.padEnd(6)}` +
      `${p.position.padEnd(7)}` +
      `${String(p.gamesPlayed).padStart(2)}  ` +
      `${p.totalPoints.toFixed(1).padStart(7)}  ` +
      `${avgPts.padStart(5)}  ` +
      `${avgRating.padStart(6)}  ` +
      `${String(p.goals).padStart(5)}  ` +
      `${String(p.assists).padStart(3)}  ` +
      `GW${p.bestGW} (${p.bestGWPoints.toFixed(1)})`
    );
  }

  // ── Per-position top 10 ────────────────────────────────────────────────
  const positions = ['GK', 'DEF', 'MID', 'ATT'];
  const broadToGroup = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'ATT' };

  for (const grp of positions) {
    const groupPlayers = sorted.filter(p => broadToGroup[p.broadPos] === grp || getPositionGroup(p.position) === grp);
    const top = groupPlayers.slice(0, 10);

    console.log(`\n── Top 10 ${grp} ${'─'.repeat(60 - grp.length)}`);
    console.log('Rank  Player              Team  Pos    GP    Pts     Avg');
    console.log('─'.repeat(65));
    top.forEach((p, i) => {
      const overallRank = sorted.indexOf(p) + 1;
      console.log(
        `${String(i + 1).padStart(4)}  ` +
        `${p.name.padEnd(20)}` +
        `${p.team.padEnd(6)}` +
        `${p.position.padEnd(7)}` +
        `${String(p.gamesPlayed).padStart(2)}  ` +
        `${p.totalPoints.toFixed(1).padStart(7)}  ` +
        `${(p.totalPoints / p.gamesPlayed).toFixed(1).padStart(5)}` +
        `  (overall #${overallRank})`
      );
    });
  }

  // ── Consistency leaders (min 10 GW) ─────────────────────────────────────
  const consistent = Array.from(playerTotals.values())
    .filter(p => p.gamesPlayed >= 10)
    .sort((a, b) => (b.totalPoints / b.gamesPlayed) - (a.totalPoints / a.gamesPlayed));

  console.log('\n── Top 50 by Avg Points Per Game (min 10 GW) ─────────────────');
  console.log('Rank  Player              Team  Pos    GP    Pts     Avg');
  console.log('─'.repeat(65));
  for (let i = 0; i < Math.min(50, consistent.length); i++) {
    const p = consistent[i];
    console.log(
      `${String(i + 1).padStart(4)}  ` +
      `${p.name.padEnd(20)}` +
      `${p.team.padEnd(6)}` +
      `${p.position.padEnd(7)}` +
      `${String(p.gamesPlayed).padStart(2)}  ` +
      `${p.totalPoints.toFixed(1).padStart(7)}  ` +
      `${(p.totalPoints / p.gamesPlayed).toFixed(1).padStart(5)}`
    );
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  const allPoints = sorted.map(p => p.totalPoints / p.gamesPlayed);
  const avgAcrossAll = allPoints.reduce((s, v) => s + v, 0) / allPoints.length;
  const maxSingleGW = Math.max(...Array.from(playerTotals.values()).flatMap(p => p.gwBreakdown.map(b => b.points)));

  console.log('\n' + '═'.repeat(60));
  console.log('  Season Summary Stats');
  console.log('═'.repeat(60));
  console.log(`  Total GWs computed: ${finishedGWs.length}`);
  console.log(`  Total player-GW records: ${Array.from(playerTotals.values()).reduce((s, p) => s + p.gamesPlayed, 0)}`);
  console.log(`  Avg points per player per GW: ${avgAcrossAll.toFixed(2)}`);
  console.log(`  Highest single-GW score: ${maxSingleGW.toFixed(1)}`);
  console.log(`  #1 season total: ${sorted[0]?.name} — ${sorted[0]?.totalPoints.toFixed(1)} pts (${sorted[0]?.gamesPlayed} GW)`);
  console.log();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
