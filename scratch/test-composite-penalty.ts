import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, curveFinalRating, calculateFantasyPoints, getPositionGroup } from '../src/lib/scoring/matchRating';
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

// Locked-in base weights (summing to exactly 0.75 base)
const WEIGHTS = {
  DM: { match_impact: 0.30, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 }
};

const FLEX_CONFIG = {
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] }
};

function calculateSimulatedRating(
    stats: RawStats,
    position: 'DM' | 'CM',
    refStats: Record<GranularPosition, ReferenceStats>,
    applyCompPenalty: boolean
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = (refStats as any)[position];

    // Clean sheet
    const csPosGroup = getPositionGroup(position);
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (csPosGroup === 'GK' || csPosGroup === 'DEF' || position === 'DM') {
            csBonus = 12;
        } else if (position === 'CM') {
            csBonus = 4;
        }
    }
    
    const xgc = stats.expected_goals_conceded ?? 0;
    const gc = stats.goals_conceded;
    
    // Using Standard V2 defensive raw internally
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    const defensiveRaw = dc + csBonus + xgcOutperf - gcPenalty;

    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const scores: any = {
        match_impact: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        influence: sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev),
        creativity: sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev),
        threat: sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev),
        defensive: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        goal_involvement: sigmoidNormalize(stats.goals * 6 + stats.assists * 4, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
        finishing: sigmoidNormalize((stats.goals - (stats.expected_goals ?? 0)) + ((stats.assists - (stats.expected_assists ?? 0)) * 0.5), GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
        save_score: 0.5,
    };

    const flexConfig = (FLEX_CONFIG as any)[position];

    let maxScore = -1;
    let maxComponent = '';
    for (const key of flexConfig.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(WEIGHTS[position])) {
        const weight = (WEIGHTS[position] as any)[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        if (finalWeight === 0) continue;
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

    // Apply composite level goals conceded penalty
    if (applyCompPenalty) {
      if (position === 'DM') {
        composite = Math.max(0, composite - (gc * 0.04));
      } else if (position === 'CM') {
        composite = Math.max(0, composite - (gc * 0.02));
      }
    }

    let rating = curveFinalRating(composite, stats.minutes_played);
    let scoringRating = 1.0 + 9.0 * composite;
    scoringRating = Math.max(1.0, Math.min(10.0, scoringRating));

    let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(fantasyPoints * 10) / 10,
    };
}

(async () => {
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

  const players = [
    { name: "Elliot Anderson", actualPos: "DM" },
    { name: "James Garner", actualPos: "DM" },
    { name: "Moisés Caicedo", actualPos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", actualPos: "DM" }
  ];

  console.log("=== SIMULATING COMPOSITE LEVEL GOALS CONCEDED PENALTY ===");

  for (const item of players) {
    const { data: playersFound } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', `%${item.name}%`);

    if (!playersFound || playersFound.length === 0) continue;
    const p = playersFound[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let ptsStd = 0, ratStd = 0;
    let ptsPen = 0, ratPen = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      gp++;

      const std = calculateSimulatedRating(stats, 'DM', refStats, false);
      const pen = calculateSimulatedRating(stats, 'DM', refStats, true);

      ptsStd += std.fantasyPoints;
      ratStd += std.rating;

      ptsPen += pen.fantasyPoints;
      ratPen += pen.rating;
    }

    console.log(`Player: ${p.name} (Games Analyzed: ${gp})`);
    console.log(`  - Standard Proposed V2 (No Comp Pen): Rating = ${(ratStd / gp).toFixed(2)}, PPG = ${(ptsStd / gp).toFixed(1)}`);
    console.log(`  - WITH Composite GC Penalty        : Rating = ${(ratPen / gp).toFixed(2)}, PPG = ${(ptsPen / gp).toFixed(1)}`);
    console.log(`  - Net Shift                         : PPG = ${((ptsPen - ptsStd) / gp).toFixed(1)}`);
    console.log("--------------------------------------------------");
  }

  console.log("\n=== INDIVIDUAL 3-0 DEFEAT SIMULATION (DM with 7 tackles) ===");
  const stats: RawStats = {
    minutes_played: 90,
    clean_sheet: false,
    goals_conceded: 3,
    expected_goals_conceded: 1.5,
    fpl_tackles: 7,
    fpl_recoveries: 5,
    fpl_def_contrib: 12,
    bps: 20,
    influence: 30,
    creativity: 10,
    threat: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    penalty_saves: 0,
    expected_goals: 0,
    expected_assists: 0
  };

  const stdGame = calculateSimulatedRating(stats, 'DM', refStats, false);
  const penGame = calculateSimulatedRating(stats, 'DM', refStats, true);

  console.log(`Standard Proposed V2 (No Comp Pen): Rating = ${stdGame.rating}, Points = ${stdGame.fantasyPoints}`);
  console.log(`WITH Composite GC Penalty        : Rating = ${penGame.rating}, Points = ${penGame.fantasyPoints}`);
})();
