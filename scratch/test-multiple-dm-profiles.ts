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

// CONFIGURATIONS TO COMPARE
const PROFILES = [
  {
    name: "Original V2",
    weights: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
  },
  {
    name: "Proposed V2 (Defensive Shift 25%)",
    weights: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
  },
  {
    name: "Moderate Shift (Defensive 15%, Influence 15%, Creativity 10%)",
    weights: { match_impact: 0.30, influence: 0.15, creativity: 0.10, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
  },
  {
    name: "Conservative Shift (Defensive 15%, Influence 20%, Creativity 05%)",
    weights: { match_impact: 0.30, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
  },
  {
    name: "Balanced Muted (Defensive 15%, Influence 10%, Match Impact 35%, Creativity 10%)",
    weights: { match_impact: 0.35, influence: 0.10, creativity: 0.10, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
  }
];

const FLEX_CONFIG = { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] };

function calculateSimulatedRating(
    stats: RawStats,
    ref: ReferenceStats,
    weights: Record<string, number>
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    // Clean sheet
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        csBonus = 12;
    }
    
    const xgc = stats.expected_goals_conceded ?? 0;
    const gc = stats.goals_conceded;
    
    // Test a reduced multiplier for outfield players (e.g. 1.5 instead of 5.0) to avoid keeper luck bias
    const xgcMultiplier = 1.5; 
    const xgcOutperf = Math.max(0, xgc - gc) * xgcMultiplier;
    const gcPenalty = Math.max(0, gc - xgc) * xgcMultiplier;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);
    const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
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

    let maxScore = -1;
    let maxComponent = '';
    for (const key of FLEX_CONFIG.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(weights)) {
        const weight = weights[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += FLEX_CONFIG.flex;
        }
        if (finalWeight === 0) continue;
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

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

  const playersToTest = [
    { name: "Elliot Anderson", pos: "DM" },
    { name: "James Garner", pos: "DM" },
    { name: "Declan Rice", pos: "DM" },
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", pos: "DM" },
    { name: "João Palhinha", pos: "DM" }
  ];

  console.log("=== COMPARING DIFFERENT DM WEIGHT PROFILES ===");

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`)
      .eq('primary_position', item.pos);

    if (!players || players.length === 0) {
      continue;
    }
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      continue;
    }

    console.log(`Player: ${p.name} (${p.primary_position})`);
    
    for (const profile of PROFILES) {
      let gp = 0, pts = 0, rat = 0;
      for (const r of statsRows) {
        const stats = r.stats as any;
        if (!stats || stats.minutes_played < 60) continue;
        gp++;

        const res = calculateSimulatedRating(stats, refStats.DM, profile.weights);
        pts += res.fantasyPoints;
        rat += res.rating;
      }
      const avgPts = pts / gp;
      const avgRat = rat / gp;
      console.log(`  - ${profile.name.padEnd(65)}: Rating = ${avgRat.toFixed(2)} | PPG = ${avgPts.toFixed(1)}`);
    }
    console.log("--------------------------------------------------");
  }
})();
