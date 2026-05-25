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

// ORIGINAL WEIGHTS
const ORIGINAL_WEIGHTS: Record<string, Record<string, number>> = {
  DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
  AM: { match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
  LW: { match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00 },
  RW: { match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00 },
};

// MULTIPLE PROPOSED OPTIONS (Surgically balanced, summing to exactly 0.75 base)
const PROPOSED_OPTIONS = {
  // Option A (Initial precise idea)
  optA: {
    DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
    AM: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.05, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    LW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    RW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
  },
  // Option B (Tuning threat/finishing and CM threat balance)
  optB: {
    DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }, // same
    CM: { match_impact: 0.25, influence: 0.10, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 }, // threat -> 0, influence -> 0.10
    AM: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.05, save_score: 0.00 }, // finishing -> 0.05, threat -> 0.10
    LW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }, // same
    RW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 }, // same
  },
  // Option C (Keeping AM threat at 0.15 and 0% finishing, but with match impact / creativity shift)
  optC: {
    DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }, // same
    CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 }, // defensive -> 0.20, influence -> 0.05, threat -> 0
    AM: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 }, // finishing -> 0, threat -> 0.15
    LW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.20, defensive: 0.00, goal_involvement: 0.15, finishing: 0.05, save_score: 0.00 }, // finishing -> 0.05, threat -> 0.20
    RW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.20, defensive: 0.00, goal_involvement: 0.15, finishing: 0.05, save_score: 0.00 }, // finishing -> 0.05, threat -> 0.20
  },
  // Option D (The "Honest Masterpiece" - combines best of DM, CM Option C, AM Option C, and Winger Option D)
  optD: {
    DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
    CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 }, // CM Option C
    AM: { match_impact: 0.15, influence: 0.10, creativity: 0.20, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 }, // AM Option C
    LW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.15, save_score: 0.00 }, // Winger Option D
    RW: { match_impact: 0.15, influence: 0.05, creativity: 0.15, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.15, save_score: 0.00 }, // Winger Option D
  }
};

const FLEX_CONFIG: Record<string, { flex: number; components: string[] }> = {
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
  AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
  LW: { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat'] },
  RW: { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat'] },
};

function calculateSimulatedRating(
    stats: RawStats,
    position: any,
    refStats: Record<GranularPosition, ReferenceStats>,
    weights: Record<string, number>
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = (refStats as any)[position] ?? refStats.CM;

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
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);
    const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);

    let defActionsRaw: number;
    if (position === 'CB') {
        defActionsRaw = tackles + cbi * 0.5;
    } else if (position === 'LB' || position === 'RB' || position === 'LWB' || position === 'RWB') {
        defActionsRaw = dc + recoveries * 0.5;
    } else {
        defActionsRaw = dc;
    }

    const defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;

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
    // DMs
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Declan Rice", pos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", pos: "DM" },
    { name: "Kobbie Mainoo", pos: "DM" },
    // CMs
    { name: "Alexis Mac Allister", pos: "CM" },
    { name: "Martin Ødegaard", pos: "CM" },
    { name: "Bruno Guimarães", pos: "CM" },
    { name: "Bernardo Silva", pos: "CM" },
    // AMs
    { name: "Bruno Fernandes", pos: "AM" },
    { name: "Cole Palmer", pos: "AM" },
    { name: "Dominik Szoboszlai", pos: "AM" },
    // Wingers
    { name: "Mohamed Salah", pos: "RW" },
    { name: "Bukayo Saka", pos: "RW" },
    { name: "Jarrod Bowen", pos: "RW" },
    { name: "Cody Gakpo", pos: "LW" },
    { name: "Pedro Neto", pos: "RW" },
    { name: "Antoine Semenyo", pos: "RW" },
    { name: "Brennan Johnson", pos: "RW" },
  ];

  console.log("=== COMPARING OPTION A, B, AND C MULTI-POSITION WEIGHING (ALL BASE SUM TO exactly 0.75) ===\n");

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`)
      .eq('primary_position', item.pos);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let ptsOrig = 0, ptsA = 0, ptsB = 0, ptsC = 0, ptsD = 0;
    let ratOrig = 0, ratA = 0, ratB = 0, ratC = 0, ratD = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;

      const orig = calculateSimulatedRating(stats, p.primary_position, refStats, ORIGINAL_WEIGHTS[p.primary_position]);
      const resA = calculateSimulatedRating(stats, p.primary_position, refStats, PROPOSED_OPTIONS.optA[p.primary_position]);
      const resB = calculateSimulatedRating(stats, p.primary_position, refStats, PROPOSED_OPTIONS.optB[p.primary_position]);
      const resC = calculateSimulatedRating(stats, p.primary_position, refStats, PROPOSED_OPTIONS.optC[p.primary_position]);
      const resD = calculateSimulatedRating(stats, p.primary_position, refStats, PROPOSED_OPTIONS.optD[p.primary_position]);

      ptsOrig += orig.fantasyPoints;
      ptsA += resA.fantasyPoints;
      ptsB += resB.fantasyPoints;
      ptsC += resC.fantasyPoints;
      ptsD += resD.fantasyPoints;

      ratOrig += orig.rating;
      ratA += resA.rating;
      ratB += resB.rating;
      ratC += resC.rating;
      ratD += resD.rating;
    }

    if (gp === 0) continue;

    console.log(`Player: ${p.name} (${p.primary_position}) | Games: ${gp}`);
    console.log(`  - Original V2: Rating = ${(ratOrig/gp).toFixed(2)}, PPG = ${(ptsOrig/gp).toFixed(1)}`);
    console.log(`  - Option A:    Rating = ${(ratA/gp).toFixed(2)} (${((ratA-ratOrig)/gp).toFixed(2)}), PPG = ${(ptsA/gp).toFixed(1)} (${((ptsA-ptsOrig)/gp).toFixed(1)})`);
    console.log(`  - Option B:    Rating = ${(ratB/gp).toFixed(2)} (${((ratB-ratOrig)/gp).toFixed(2)}), PPG = ${(ptsB/gp).toFixed(1)} (${((ptsB-ptsOrig)/gp).toFixed(1)})`);
    console.log(`  - Option C:    Rating = ${(ratC/gp).toFixed(2)} (${((ratC-ratOrig)/gp).toFixed(2)}), PPG = ${(ptsC/gp).toFixed(1)} (${((ptsC-ptsOrig)/gp).toFixed(1)})`);
    console.log(`  - Option D:    Rating = ${(ratD/gp).toFixed(2)} (${((ratD-ratOrig)/gp).toFixed(2)}), PPG = ${(ptsD/gp).toFixed(1)} (${((ptsD-ptsOrig)/gp).toFixed(1)})`);
    console.log("--------------------------------------------------");
  }
})();
