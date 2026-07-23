const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      let val = trimmed.substring(equalsIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Supabase URL:', supabaseUrl ? 'Found' : 'Missing');
console.log('Service Key:', serviceKey ? 'Found' : 'Missing');

const supabase = createClient(supabaseUrl, serviceKey);

const DEFAULT_REFERENCE_STATS = {
  GK: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 10, stddev: 5 }, creativity: { median: 5, stddev: 3 }, threat: { median: 0, stddev: 1 }, defensive: { median: 2, stddev: 1 }, goal_involvement: { median: 0, stddev: 0.5 }, finishing: { median: 0, stddev: 0.5 }, save_score: { median: 5, stddev: 3 } },
  CB: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 15, stddev: 7 }, creativity: { median: 5, stddev: 3 }, threat: { median: 2, stddev: 1.5 }, defensive: { median: 6, stddev: 3 }, goal_involvement: { median: 0.2, stddev: 0.5 }, finishing: { median: 0.1, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
  LB: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 15, stddev: 7 }, creativity: { median: 10, stddev: 5 }, threat: { median: 4, stddev: 2 }, defensive: { median: 5, stddev: 2.5 }, goal_involvement: { median: 0.3, stddev: 0.6 }, finishing: { median: 0.1, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
  RB: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 15, stddev: 7 }, creativity: { median: 10, stddev: 5 }, threat: { median: 4, stddev: 2 }, defensive: { median: 5, stddev: 2.5 }, goal_involvement: { median: 0.3, stddev: 0.6 }, finishing: { median: 0.1, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
  DM: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 20, stddev: 8 }, creativity: { median: 10, stddev: 5 }, threat: { median: 2, stddev: 1.5 }, defensive: { median: 7, stddev: 3 }, goal_involvement: { median: 0.2, stddev: 0.5 }, finishing: { median: 0.1, stddev: 0.4 }, save_score: { median: 0, stddev: 1 } },
  CM: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 20, stddev: 8 }, creativity: { median: 15, stddev: 7 }, threat: { median: 6, stddev: 3 }, defensive: { median: 4, stddev: 2 }, goal_involvement: { median: 0.4, stddev: 0.7 }, finishing: { median: 0.2, stddev: 0.5 }, save_score: { median: 0, stddev: 1 } },
  LWB: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 18, stddev: 7.5 }, creativity: { median: 12, stddev: 6 }, threat: { median: 5, stddev: 2.5 }, defensive: { median: 4.5, stddev: 2.5 }, goal_involvement: { median: 0.35, stddev: 0.65 }, finishing: { median: 0.15, stddev: 0.45 }, save_score: { median: 0, stddev: 1 } },
  RWB: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 18, stddev: 7.5 }, creativity: { median: 12, stddev: 6 }, threat: { median: 5, stddev: 2.5 }, defensive: { median: 4.5, stddev: 2.5 }, goal_involvement: { median: 0.35, stddev: 0.65 }, finishing: { median: 0.15, stddev: 0.45 }, save_score: { median: 0, stddev: 1 } },
  AM: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 22, stddev: 9 }, creativity: { median: 20, stddev: 9 }, threat: { median: 10, stddev: 4 }, defensive: { median: 2, stddev: 1.5 }, goal_involvement: { median: 0.6, stddev: 0.8 }, finishing: { median: 0.3, stddev: 0.6 }, save_score: { median: 0, stddev: 1 } },
  LW: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 20, stddev: 8 }, creativity: { median: 18, stddev: 8 }, threat: { median: 12, stddev: 5 }, defensive: { median: 2, stddev: 1.5 }, goal_involvement: { median: 0.7, stddev: 0.85 }, finishing: { median: 0.4, stddev: 0.7 }, save_score: { median: 0, stddev: 1 } },
  RW: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 20, stddev: 8 }, creativity: { median: 18, stddev: 8 }, threat: { median: 12, stddev: 5 }, defensive: { median: 2, stddev: 1.5 }, goal_involvement: { median: 0.7, stddev: 0.85 }, finishing: { median: 0.4, stddev: 0.7 }, save_score: { median: 0, stddev: 1 } },
  ST: { match_impact: { median: 1.0, stddev: 0.5 }, influence: { median: 22, stddev: 9 }, creativity: { median: 10, stddev: 5 }, threat: { median: 16, stddev: 6 }, defensive: { median: 1, stddev: 1 }, goal_involvement: { median: 0.8, stddev: 0.9 }, finishing: { median: 0.6, stddev: 0.8 }, save_score: { median: 0, stddev: 1 } },
};

function sigmoid(x, median, stddev) {
  if (stddev <= 0) return 0.5;
  const z = (x - median) / stddev;
  return 1 / (1 + Math.exp(-z));
}

const POSITION_WEIGHTS = {
  GK: { match_impact: 0.25, influence: 0.20, creativity: 0.00, threat: 0.00, defensive: 0.32, goal_involvement: 0.00, finishing: 0.00, save_score: 0.03 },
  CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 },
  LB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  RB: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  LWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  RWB: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  AM: { match_impact: 0.20, influence: 0.10, creativity: 0.25, threat: 0.10, defensive: 0.00, goal_involvement: 0.20, finishing: 0.15, save_score: 0.00 },
  LW: { match_impact: 0.15, influence: 0.05, creativity: 0.20, threat: 0.20, defensive: 0.00, goal_involvement: 0.25, finishing: 0.15, save_score: 0.00 },
  RW: { match_impact: 0.15, influence: 0.05, creativity: 0.20, threat: 0.20, defensive: 0.00, goal_involvement: 0.25, finishing: 0.15, save_score: 0.00 },
  ST: { match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.25, finishing: 0.25, save_score: 0.00 },
};

function calculateMatchRating(stats, position, refStatsInput) {
  const refStats = refStatsInput && refStatsInput[position] ? refStatsInput : DEFAULT_REFERENCE_STATS;
  const posRef = refStats[position] || DEFAULT_REFERENCE_STATS[position] || DEFAULT_REFERENCE_STATS.CM;

  const mins = Number(stats?.minutes_played ?? 0);
  if (mins <= 0) return { rating: 0, fantasyPoints: 0 };

  const rawMatchImpact = (Number(stats?.goals_scored ?? 0) * 4) + (Number(stats?.assists ?? 0) * 3) + (Number(stats?.clean_sheets ?? 0) * 2);
  const rawInfluence = Number(stats?.influence ?? 0);
  const rawCreativity = Number(stats?.creativity ?? 0);
  const rawThreat = Number(stats?.threat ?? 0);
  const rawDefensive = (Number(stats?.tackles ?? 0) * 1) + (Number(stats?.interceptions ?? 0) * 1) + (Number(stats?.clearances ?? 0) * 0.5) + (Number(stats?.recoveries ?? 0) * 0.2);
  const rawGoalInvolvement = Number(stats?.goals_scored ?? 0) + Number(stats?.assists ?? 0);
  const rawFinishing = Number(stats?.goals_scored ?? 0);
  const rawSaveScore = (Number(stats?.saves ?? 0) * 1) + (Number(stats?.penalties_saved ?? 0) * 5);

  const compMatchImpact = sigmoid(rawMatchImpact, posRef.match_impact.median, posRef.match_impact.stddev);
  const compInfluence = sigmoid(rawInfluence, posRef.influence.median, posRef.influence.stddev);
  const compCreativity = sigmoid(rawCreativity, posRef.creativity.median, posRef.creativity.stddev);
  const compThreat = sigmoid(rawThreat, posRef.threat.median, posRef.threat.stddev);
  const compDefensive = sigmoid(rawDefensive, posRef.defensive.median, posRef.defensive.stddev);
  const compGoalInvolvement = sigmoid(rawGoalInvolvement, posRef.goal_involvement.median, posRef.goal_involvement.stddev);
  const compFinishing = sigmoid(rawFinishing, posRef.finishing.median, posRef.finishing.stddev);
  const compSaveScore = sigmoid(rawSaveScore, posRef.save_score.median, posRef.save_score.stddev);

  const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
  const weightedComposite =
    compMatchImpact * weights.match_impact +
    compInfluence * weights.influence +
    compCreativity * weights.creativity +
    compThreat * weights.threat +
    compDefensive * weights.defensive +
    compGoalInvolvement * weights.goal_involvement +
    compFinishing * weights.finishing +
    compSaveScore * weights.save_score;

  let rating = 1.0 + (weightedComposite * 9.0);
  if (mins < 90) {
    const scaleFactor = Math.pow(mins / 90, 0.4);
    rating = 1.0 + ((rating - 1.0) * scaleFactor);
  }
  rating = Math.max(1.0, Math.min(10.0, rating));
  const fantasyPoints = Number((rating * (mins / 90) * 3).toFixed(2));

  return { rating: Number(rating.toFixed(2)), fantasyPoints };
}

async function buildArchivedDataset() {
  console.log('Generating pre-computed archived stats dataset for 2025-26...');
  const season = '2025-26';

  const FULL_PLAYER_SELECT = 'id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at';

  const [{ data: playersData, error: pErr }, { data: rankings }, { data: archives }, { data: refData }] = await Promise.all([
    supabase.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true).order('total_points', { ascending: false, nullsFirst: false }),
    supabase.from('player_rankings').select('*'),
    supabase.from('season_player_stats_archive').select('player_id, ppg, form_rating, overall_rank, position_ranks').eq('season', season),
    supabase.from('rating_reference_stats').select('*').eq('season', season),
  ]);

  if (pErr) console.error('Players error:', pErr);

  console.log(`Fetched ${playersData ? playersData.length : 0} active players.`);

  const archiveMap = new Map((archives || []).map(a => [a.player_id, a]));
  const rankMap = new Map((rankings || []).map(r => [r.player_id, r]));
  const players = (playersData || []).map(p => {
    const ranks = rankMap.get(p.id);
    const arch = archiveMap.get(p.id);
    return {
      ...p,
      ppg: arch ? Number(arch.ppg) : p.ppg,
      form_rating: arch ? Number(arch.form_rating) : p.form_rating,
      overall_rank: arch ? arch.overall_rank : ranks?.overall_rank,
      position_ranks: arch ? arch.position_ranks : ranks?.position_ranks,
      owner_team_id: null,
      owner_team_name: null,
    };
  });

  const playerMap = new Map(players.map(p => [p.id, p]));

  const allStats = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await supabase
      .from('player_stats')
      .select('player_id, match_rating, fantasy_points, stats')
      .eq('season', season)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!data || data.length === 0) break;
    allStats.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  console.log(`Fetched ${allStats.length} player_stats rows for ${season}.`);

  const refStats = {};
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
  }

  function buildStatsAgg(minMins) {
    const shadowAgg = new Map();

    for (const r of allStats) {
      const minutes = Number(r.stats?.minutes_played ?? 0);
      if (minutes <= 0 || minutes < minMins) continue;

      const p = playerMap.get(r.player_id);
      if (!p) continue;

      let playerMapEntry = shadowAgg.get(r.player_id);
      if (!playerMapEntry) {
        playerMapEntry = new Map();
        shadowAgg.set(r.player_id, playerMapEntry);
      }

      const primPos = p.primary_position ? String(p.primary_position).toUpperCase() : '';
      if (primPos) {
        let primAcc = playerMapEntry.get(primPos);
        if (!primAcc) {
          primAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerMapEntry.set(primPos, primAcc);
        }
        primAcc.gp += 1;
        primAcc.pts += Number(r.fantasy_points ?? 0);
        primAcc.sumR += Number(r.match_rating ?? 0);
        primAcc.mins += minutes;
      }

      const secPositions = (p.secondary_positions ?? []);
      for (const secPos of secPositions) {
        const posKey = String(secPos).toUpperCase();
        if (!posKey || posKey === primPos) continue;

        let secAcc = playerMapEntry.get(posKey);
        if (!secAcc) {
          secAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerMapEntry.set(posKey, secAcc);
        }

        const dynamicRating = calculateMatchRating(r.stats, posKey, refStats);
        secAcc.gp += 1;
        secAcc.pts += dynamicRating.fantasyPoints;
        secAcc.sumR += dynamicRating.rating;
        secAcc.mins += minutes;
      }
    }

    const result = {};
    for (const [pid, playerMapEntry] of shadowAgg) {
      result[pid] = {};
      for (const [pos, ex] of playerMapEntry) {
        result[pid][pos] = {
          gp: ex.gp,
          total_points: Number(ex.pts.toFixed(2)),
          avg_rating: Number((ex.gp > 0 ? ex.sumR / ex.gp : 0).toFixed(2)),
          total_minutes: ex.mins,
        };
      }
    }
    return result;
  }

  const shadowMaps = {
    all: buildStatsAgg(15),
    gt45: buildStatsAgg(45),
  };

  const fileContent = `/**
 * Pre-computed archived stats for 2025-26 season.
 * Auto-generated for instant page loads.
 */

export const PRECOMPUTED_STATS_2025_26 = ${JSON.stringify({ players, shadowMaps }, null, 2)};
`;

  fs.writeFileSync('src/lib/season/archived_stats_2025_26.ts', fileContent);
  console.log('Saved src/lib/season/archived_stats_2025_26.ts successfully!');
}

buildArchivedDataset();
