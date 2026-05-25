import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, curveFinalRating, calculateFantasyPoints } from '../src/lib/scoring/matchRating';
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

// WEIGHT DEFINITIONS
const ORIGINAL_WEIGHTS: Record<string, Record<string, number>> = {
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  AM: { match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  ST: { match_impact: 0.15, influence: 0.10, creativity: 0.10, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }
};

const PROPOSED_WEIGHTS: Record<string, Record<string, number>> = {
  // Balanced Conservative CM
  CM: { match_impact: 0.25, influence: 0.10, creativity: 0.15, threat: 0.05, defensive: 0.10, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  // Proposed AM Calibration
  AM: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  // Locked-in ST weights (V2 setup)
  ST: { match_impact: 0.15, influence: 0.10, creativity: 0.10, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }
};

const FLEX_CONFIG: Record<string, { flex: number; components: string[] }> = {
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] }
};

function calculateSimulatedRating(
    stats: RawStats,
    position: GranularPosition,
    refStats: Record<GranularPosition, ReferenceStats>,
    weights: Record<string, number>
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = refStats[position] ?? refStats.AM;

    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (position === 'CM') {
            csBonus = 4;
        }
    }
    
    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;
    const defensiveRaw = (stats.fpl_def_contrib ?? 0) + csBonus + xgcOutperf - gcPenalty;

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

    const flexConfig = FLEX_CONFIG[position] ?? FLEX_CONFIG.AM;

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
        const weight = weights[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
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
    { name: "Enzo Fernández", expectedPos: "CM", id: "516062f0-61b3-4587-9191-eb9525e6cfcc" },
    { name: "Florian Wirtz", expectedPos: "AM", id: "c184cc1f-317e-48af-9c67-22c2a272c420" },
    { name: "João Pedro", expectedPos: "ST", id: "00b2b501-9743-4473-9ba0-dce35927a988" },
    { name: "Dominik Szoboszlai", expectedPos: "AM", id: "ad4ecab9-d1d8-46be-b6ef-7e0aee0efa14" }
  ];

  console.log("=== SIMULATING AM UPGRADES FOR REQUESTED PLAYERS ===");

  const seenIds = new Set<string>();

  for (const item of playersToTest) {
    let p: any = null;
    if (item.id) {
      const { data } = await supabase
        .from('players')
        .select('id, name, primary_position')
        .eq('id', item.id);
      if (data && data.length > 0) p = data[0];
    } else {
      const { data: players } = await supabase
        .from('players')
        .select('id, name, primary_position')
        .ilike('name', `%${item.name}%`);
      if (players && players.length > 0) p = players[0];
    }

    if (!p) continue;
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);

    const pos = p.primary_position as GranularPosition;

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      console.log(`❌ No stats rows found for ${p.name}`);
      continue;
    }

    let gp = 0;
    let ptsOrigPrim = 0, ptsPropPrim = 0, ratOrigPrim = 0, ratPropPrim = 0;
    let ptsOrigAM = 0, ptsPropAM = 0, ratOrigAM = 0, ratPropAM = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;

      // Primary position rating
      const origPrim = calculateSimulatedRating(stats, pos, refStats, ORIGINAL_WEIGHTS[pos] || ORIGINAL_WEIGHTS.CM);
      const propPrim = calculateSimulatedRating(stats, pos, refStats, PROPOSED_WEIGHTS[pos] || PROPOSED_WEIGHTS.CM);
      ptsOrigPrim += origPrim.fantasyPoints;
      ptsPropPrim += propPrim.fantasyPoints;
      ratOrigPrim += origPrim.rating;
      ratPropPrim += propPrim.rating;

      // AM slot rating (OOP)
      const origAM = calculateSimulatedRating(stats, 'AM', refStats, ORIGINAL_WEIGHTS.AM);
      const propAM = calculateSimulatedRating(stats, 'AM', refStats, PROPOSED_WEIGHTS.AM);
      ptsOrigAM += origAM.fantasyPoints;
      ptsPropAM += propAM.fantasyPoints;
      ratOrigAM += origAM.rating;
      ratPropAM += propAM.rating;
    }

    console.log(`Player: ${p.name} (Primary: ${pos}) | Games: ${gp}`);
    console.log(`  AS PRIMARY POSITION (${pos}):`);
    console.log(`    - Original V2: Rating = ${(ratOrigPrim / gp).toFixed(2)}, PPG = ${(ptsOrigPrim / gp).toFixed(1)}`);
    console.log(`    - Proposed V2: Rating = ${(ratPropPrim / gp).toFixed(2)}, PPG = ${(ptsPropPrim / gp).toFixed(1)}`);
    console.log(`    - Net Shift  : Rating = ${((ratPropPrim - ratOrigPrim) / gp).toFixed(2)} | PPG = ${((ptsPropPrim - ptsOrigPrim) / gp).toFixed(1)}`);
    
    console.log(`  AS DEPLOYED AM:`);
    console.log(`    - Original V2: Rating = ${(ratOrigAM / gp).toFixed(2)}, PPG = ${(ptsOrigAM / gp).toFixed(1)}`);
    console.log(`    - Proposed V2: Rating = ${(ratPropAM / gp).toFixed(2)}, PPG = ${(ptsPropAM / gp).toFixed(1)}`);
    console.log(`    - Net Shift  : Rating = ${((ratPropAM - ratOrigAM) / gp).toFixed(2)} | PPG = ${((ptsPropAM - ptsOrigAM) / gp).toFixed(1)}`);
    console.log("--------------------------------------------------");
  }
})();
