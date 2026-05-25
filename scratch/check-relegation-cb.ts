import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS, getPositionGroup, curveFinalRating, calculateFantasyPoints } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats } from '@/types';

// Custom env loader
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        process.env[key] = value;
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

// SIMULATION WEIGHTS (TWEAKED)
const TWEAKED_WEIGHTS: Record<string, Record<string, number>> = {
  CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.05, save_score: 0.00 }
};

const FLEX_CONFIG: Record<string, { flex: number; components: string[] }> = {
  CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] }
};

function calculateSimulatedRating(
    stats: RawStats,
    refStats: Record<GranularPosition, ReferenceStats>,
    useTweaks: boolean
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = refStats.CB ?? refStats.CM;

    // Clean sheet
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        csBonus = 12;
    }
    
    const xgc = stats.expected_goals_conceded ?? 0;
    const gc = stats.goals_conceded;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);

    // Exclusion of clearances for CB
    const defActionsRaw = tackles + cbi * 0.5;

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

    const ORIGINAL_WEIGHTS = { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.20, finishing: 0.05, save_score: 0.00 };
    const TWEAKED_CB = TWEAKED_WEIGHTS.CB;

    const weights = useTweaks ? TWEAKED_CB : ORIGINAL_WEIGHTS;
    const flexConfig = FLEX_CONFIG.CB;

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
        const weight = (weights as any)[key];
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

  // Tarkowski is a high-clearance, relegation-style defender (Everton)
  // Andersen / Kilman / Murillo are solid midtable CBs
  const cbNames = ["James Tarkowski", "Murillo", "Max Kilman", "Joachim Andersen"];
  
  console.log("=== RELEGATION / MIDTABLE CB WEIGHT ANALYSIS ===");

  for (const name of cbNames) {
    const { data: players } = await supabase.from('players').select('id').ilike('name', `%${name}%`);
    if (!players || players.length === 0) continue;
    const p = players[0];
    const { data: statsRows } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).not('stats', 'is', null);
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0, ptsOrig = 0, ptsTweak = 0, ratOrig = 0, ratTweak = 0;
    let cleanSheets = 0;
    for (const r of statsRows) {
      if (r.stats?.minutes_played === 0) continue;
      gp++;
      if (r.stats.clean_sheet && r.stats.minutes_played >= 60) cleanSheets++;
      const orig = calculateSimulatedRating(r.stats as any, refStats, false);
      const tweak = calculateSimulatedRating(r.stats as any, refStats, true);
      ptsOrig += orig.fantasyPoints;
      ptsTweak += tweak.fantasyPoints;
      ratOrig += orig.rating;
      ratTweak += tweak.rating;
    }
    console.log(`Player: ${name} (${cleanSheets} Clean Sheets / ${gp} GP)`);
    console.log(`  - Original CB Weights: Avg Rating = ${(ratOrig / gp).toFixed(2)}, PPG = ${(ptsOrig / gp).toFixed(1)}`);
    console.log(`  - Tweaked CB Weights (0.25 Def, 0.05 GI): Avg Rating = ${(ratTweak / gp).toFixed(2)}, PPG = ${(ptsTweak / gp).toFixed(1)}`);
    console.log(`--------------------------------------------------`);
  }
})();
