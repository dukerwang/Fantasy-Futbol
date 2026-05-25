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

// Weights Configurations to test:
const DM_WEIGHTS = { match_impact: 0.30, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 };
const DM_FLEX = { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] };

function calculateSimulatedRating(
    stats: RawStats,
    position: GranularPosition,
    refStats: ReferenceStats,
    formulaType: string // "standard" or "cleanslate"
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

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
    
    let defensiveRaw = 0;
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    
    if (formulaType === "standard") {
        const xgcOutperf = Math.max(0, xgc - gc) * 5;
        const gcPenalty = Math.max(0, gc - xgc) * 5;
        defensiveRaw = dc + csBonus + xgcOutperf - gcPenalty;
    } else if (formulaType === "cleanslate") {
        // Flat penalty of 2.0 per goal conceded, no xGC outperformance bonus
        defensiveRaw = dc + csBonus - (gc * 2.0);
    } else if (formulaType === "cleanslate_strict") {
        // Flat penalty of 3.0 per goal conceded, no xGC outperformance
        defensiveRaw = dc + csBonus - (gc * 3.0);
    }

    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const scores: any = {
        match_impact: sigmoidNormalize(adjustedBps, refStats.match_impact.median, refStats.match_impact.stddev),
        influence: sigmoidNormalize(stats.influence ?? 0, refStats.influence.median, refStats.influence.stddev),
        creativity: sigmoidNormalize(stats.creativity ?? 0, refStats.creativity.median, refStats.creativity.stddev),
        threat: sigmoidNormalize(stats.threat ?? 0, refStats.threat.median, refStats.threat.stddev),
        defensive: sigmoidNormalize(defensiveRaw, refStats.defensive.median, refStats.defensive.stddev),
        goal_involvement: sigmoidNormalize(stats.goals * 6 + stats.assists * 4, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
        finishing: sigmoidNormalize((stats.goals - (stats.expected_goals ?? 0)) + ((stats.assists - (stats.expected_assists ?? 0)) * 0.5), GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
        save_score: 0.5,
    };

    let maxScore = -1;
    let maxComponent = '';
    for (const key of DM_FLEX.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(DM_WEIGHTS)) {
        const weight = (DM_WEIGHTS as any)[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += DM_FLEX.flex;
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

  const players = [
    { name: "Elliot Anderson" },
    { name: "James Garner" },
    { name: "Moisés Caicedo" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante" }
  ];

  console.log("=== COMPARING STANDARD V2 vs CLEANSLATE DEFENSIVE (GAMES >= 60 MINS) ===");

  for (const item of players) {
    const { data: playersFound } = await supabase
      .from('players')
      .select('id, name')
      .ilike('name', `%${item.name}%`);

    if (!playersFound || playersFound.length === 0) {
      console.log(`❌ Player ${item.name} not found`);
      continue;
    }
    const p = playersFound[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let ptsStd = 0, ratStd = 0;
    let ptsClean = 0, ratClean = 0;
    let ptsCleanStrict = 0, ratCleanStrict = 0;

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played < 60) continue;
      gp++;

      const std = calculateSimulatedRating(stats, 'DM', refStats.DM, 'standard');
      const clean = calculateSimulatedRating(stats, 'DM', refStats.DM, 'cleanslate');
      const cleanStrict = calculateSimulatedRating(stats, 'DM', refStats.DM, 'cleanslate_strict');

      ptsStd += std.fantasyPoints;
      ratStd += std.rating;

      ptsClean += clean.fantasyPoints;
      ratClean += clean.rating;

      ptsCleanStrict += cleanStrict.fantasyPoints;
      ratCleanStrict += cleanStrict.rating;
    }

    console.log(`Player: ${p.name} (Games: ${gp})`);
    console.log(`  - Standard V2    : Rating = ${(ratStd / gp).toFixed(2)}, PPG = ${(ptsStd / gp).toFixed(1)}`);
    console.log(`  - CleanSlate (2.0): Rating = ${(ratClean / gp).toFixed(2)}, PPG = ${(ptsClean / gp).toFixed(1)}`);
    console.log(`  - CleanStrict (3.0): Rating = ${(ratCleanStrict / gp).toFixed(2)}, PPG = ${(ptsCleanStrict / gp).toFixed(1)}`);
    console.log("--------------------------------------------------");
  }
})();
