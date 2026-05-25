import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, RatingComponent, ReferenceStats } from '@/types';

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

const SIGMOID_K = 1.0;
const GLOBAL_GI_STDDEV = 2.5;
const GLOBAL_GI_MEDIAN = 0;
const GLOBAL_FINISHING_STDDEV = 0.28;
const GLOBAL_FINISHING_MEDIAN = -0.03;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

// Model A (Current)
const MODEL_A_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_A_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat'] as RatingComponent[] };

// Model C (Proposed 2)
const MODEL_C_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.15, threat: 0.05, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_C_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model D (Flex 0.15 - Balanced Base)
const MODEL_D_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.12, influence: 0.05, creativity: 0.13, threat: 0.10, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00
};
const MODEL_D_FLEX = { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model E (Flex 0.20 - Moderate)
const MODEL_E_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.12, threat: 0.08, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00
};
const MODEL_E_FLEX = { flex: 0.20, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model F (Rebalanced 0.25 Flex - Goal involvement base 0.25)
const MODEL_F_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.12, influence: 0.05, creativity: 0.08, threat: 0.05, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00
};
const MODEL_F_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model G (Threat-Oriented 0.20 Flex)
// Sum of base = 0.80. Flex = 0.20. Boosts threat base to 0.12, drops creativity base to 0.08.
const MODEL_G_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.08, threat: 0.12, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00
};
const MODEL_G_FLEX = { flex: 0.20, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model H (Low Flex 0.18 - Perfect Goalscorer Preservation)
// Sum of base = 0.82. Flex = 0.18. Peak GI = 0.27 + 0.18 = 0.45.
// Peak creativity = 0.08 + 0.18 = 0.26. Peak threat = 0.11 + 0.18 = 0.29.
const MODEL_H_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.11, influence: 0.05, creativity: 0.08, threat: 0.11, defensive: 0.00, goal_involvement: 0.27, finishing: 0.20, save_score: 0.00
};
const MODEL_H_FLEX = { flex: 0.18, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model I (Ultra Low Flex 0.15 - Balanced Base)
// Sum of base = 0.85. Flex = 0.15. Peak GI = 0.30 + 0.15 = 0.45.
// Peak creativity = 0.08 + 0.15 = 0.23. Peak threat = 0.12 + 0.15 = 0.27.
const MODEL_I_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.08, threat: 0.12, defensive: 0.00, goal_involvement: 0.30, finishing: 0.20, save_score: 0.00
};
const MODEL_I_FLEX = { flex: 0.15, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model J (Standard 0.25 Flex - Low Creativity Base)
// Sum of base = 0.75. Flex = 0.25. Peak GI = 0.20 + 0.25 = 0.45.
// Peak creativity = 0.02 + 0.25 = 0.27. Peak threat = 0.08 + 0.25 = 0.33.
const MODEL_J_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.02, threat: 0.08, defensive: 0.00, goal_involvement: 0.20, finishing: 0.25, save_score: 0.00
};
const MODEL_J_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model K (Standard 0.25 Flex - Dribbler Elevated Base)
// Sum of base = 0.75. Flex = 0.25. Peak GI = 0.25 + 0.25 = 0.50.
// Peak creativity = 0.02 + 0.25 = 0.27. Peak threat = 0.13 + 0.25 = 0.38.
const MODEL_K_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.02, threat: 0.13, defensive: 0.00, goal_involvement: 0.25, finishing: 0.20, save_score: 0.00
};
const MODEL_K_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model L (Standard 0.25 Flex - Low Creativity, Higher Threat/Influence)
// Sum of base = 0.75. Flex = 0.25. Peak GI = 0.20 + 0.25 = 0.45. Peak finishing = 0.20 + 0.25 = 0.45.
// Peak creativity = 0.05 + 0.25 = 0.30. Peak threat = 0.10 + 0.25 = 0.35.
const MODEL_L_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_L_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model M (Standard 0.25 Flex - Low Creativity, Higher Threat/Match-Impact)
// Sum of base = 0.75. Flex = 0.25. Peak GI = 0.20 + 0.25 = 0.45. Peak finishing = 0.20 + 0.25 = 0.45.
// Peak creativity = 0.05 + 0.25 = 0.30. Peak threat = 0.10 + 0.25 = 0.35.
const MODEL_M_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_M_FLEX = { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat', 'creativity'] as RatingComponent[] };

// Model N (Standard 0.25 Flex - Swapped 3-Flex, Capped Inflation)
// Sum of base = 0.75. Flex = 0.25. Swaps creativity in and finishing out of the flex list.
// Finishing base is boosted to 0.25 to reward clinical scoring consistently in all games.
const MODEL_N_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.20, finishing: 0.25, save_score: 0.00
};
const MODEL_N_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model O (Standard 0.25 Flex - Lower Finishing Base)
// Same as Model N but lowers finishing base to 0.20 and raises match_impact base to 0.15.
const MODEL_O_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_O_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model P (Standard 0.25 Flex - Lower Threat Base)
// Same as Model N but lowers threat base to 0.05 and raises match_impact base to 0.15.
const MODEL_P_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.05, defensive: 0.00, goal_involvement: 0.20, finishing: 0.25, save_score: 0.00
};
const MODEL_P_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model Q (Standard 0.25 Flex - Lower Goal Involvement Base)
// Same as Model N but lowers goal_involvement base to 0.15 and raises match_impact base to 0.15.
const MODEL_Q_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.05, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00
};
const MODEL_Q_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model R (Standard 0.25 Flex - Balanced Dribbler Hybrid)
// Low creativity base (0.02) to suppress corners, high threat (0.13), lower finishing (0.20), higher match impact (0.15).
const MODEL_R_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.02, threat: 0.13, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_R_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model S (Standard 0.25 Flex - Ultra Conservative Base)
// Low creativity base (0.02), low threat base (0.08), high match impact (0.20), moderate finishing (0.20), goal involvement (0.20).
const MODEL_S_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.20, influence: 0.05, creativity: 0.02, threat: 0.08, defensive: 0.00, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00
};
const MODEL_S_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model T (Standard 0.25 Flex - Steal from Finishing)
// Decreases finishing base by 0.05 (to 0.20) and increases creativity base by 0.05 (to 0.10).
const MODEL_T_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.15, influence: 0.05, creativity: 0.10, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.20, save_score: 0.00
};
const MODEL_T_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };

// Model U (Standard 0.25 Flex - Steal from Match Impact)
// Decreases match_impact base by 0.05 (to 0.10) and increases creativity base by 0.05 (to 0.10).
const MODEL_U_WEIGHTS: Record<RatingComponent, number> = {
    match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.10, defensive: 0.00, goal_involvement: 0.15, finishing: 0.25, save_score: 0.00
};
const MODEL_U_FLEX = { flex: 0.25, components: ['goal_involvement', 'threat', 'creativity'] as RatingComponent[] };




function computeComponentScores(stats: RawStats, position: GranularPosition, ref: ReferenceStats): Record<RatingComponent, number> {
    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const match_impact = sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev);
    const influence = sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev);
    const creativity = sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev);
    const threat = sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev);

    const gc = stats.goals_conceded;
    const xgc = stats.expected_goals_conceded ?? 0;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    const defensiveRaw = dc + xgcOutperf - gcPenalty;
    const defensive = sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev);

    const goalInvRaw = stats.goals * 6 + stats.assists * 4;
    const goal_involvement = sigmoidNormalize(goalInvRaw, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV);

    const xg = stats.expected_goals ?? 0;
    const xa = stats.expected_assists ?? 0;
    const xgOutperf = stats.goals - xg;
    const xaOutperf = stats.assists - xa;
    const finInput = xgOutperf + (xaOutperf * 0.5);
    const finishing = sigmoidNormalize(finInput, GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV);

    return {
        match_impact, influence, creativity, threat, defensive, goal_involvement, finishing, save_score: 0.5
    };
}

function applyWeights(
    scores: Record<RatingComponent, number>,
    weights: Record<RatingComponent, number>,
    flexConfig: { flex: number; components: RatingComponent[] }
): number {
    let maxScore = -1;
    let maxComponent: RatingComponent | '' = '';

    for (const key of flexConfig.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(weights) as RatingComponent[]) {
        let finalWeight = weights[key];
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        composite += scores[key] * finalWeight;
    }

    return Math.min(1.0, composite);
}

function curveFinalRating(composite: number): number {
    let rating = 3.0 + 7.0 * composite;
    return Math.max(1.0, Math.min(10.0, rating));
}

function computeScoringRating(composite: number): number {
    let r = 1.0 + 9.0 * composite;
    return Math.max(1.0, Math.min(10.0, r));
}

function calculateFantasyPoints(rating: number): number {
    const scale = 10.0;
    const curve = Math.pow(Math.max(0, rating - 4.5) / 2.0, 1.5);
    return Math.max(0, Number((scale * curve).toFixed(1)));
}

(async () => {
  console.log("=== CALIBRATING WINGER BALANCING MODELS ===");

  const { data: refData } = await supabase.from('rating_reference_stats').select('*').eq('season', '2025/26');
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
    { name: "Antoine Semenyo", type: "RW - Direct Goalscorer" },
    { name: "Jarrod Bowen", type: "RW - Goalscoring Winger" },
    { name: "Bukayo Saka", type: "RW - Elite Hybrid" },
    { name: "Bryan Mbeumo", type: "RW - Goalscoring/Creative" },
    { name: "Jérémy Doku", type: "LW - Elite Dribbler" },
    { name: "Pedro Neto", type: "RW - Creative Dribbler" },
    { name: "Harvey Barnes", type: "LW - Goalscoring Winger" },
    { name: "Marcus Tavernier", type: "LW - Creative Winger" },
    { name: "Iliman Ndiaye", type: "LW - Dribbler/Workhorse" }
  ];


  console.log(`\nPlayer           | Profile              | Model A | Model I | Model Q | Model T | Model U`);
  console.log(`-----------------|----------------------|---------|---------|---------|---------|---------`);

  for (const item of playersToTest) {
    const { data: players } = await supabase.from('players').select('id, name, primary_position').ilike('name', `%${item.name}%`);
    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).not('stats', 'is', null);
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumA = 0; let sumI = 0; let sumQ = 0; let sumT = 0; let sumU = 0;

    const ref = refStats[p.primary_position] || DEFAULT_REFERENCE_STATS[p.primary_position as GranularPosition];

    for (const row of statsRows) {
      const stats = row.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;

      const scores = computeComponentScores(stats, p.primary_position as GranularPosition, ref);

      // Model A
      const compA = applyWeights(scores, MODEL_A_WEIGHTS, MODEL_A_FLEX);
      sumA += calculateFantasyPoints(computeScoringRating(compA));

      // Model I
      const compI = applyWeights(scores, MODEL_I_WEIGHTS, MODEL_I_FLEX);
      sumI += calculateFantasyPoints(computeScoringRating(compI));

      // Model Q
      const compQ = applyWeights(scores, MODEL_Q_WEIGHTS, MODEL_Q_FLEX);
      sumQ += calculateFantasyPoints(computeScoringRating(compQ));

      // Model T
      const compT = applyWeights(scores, MODEL_T_WEIGHTS, MODEL_T_FLEX);
      sumT += calculateFantasyPoints(computeScoringRating(compT));

      // Model U
      const compU = applyWeights(scores, MODEL_U_WEIGHTS, MODEL_U_FLEX);
      sumU += calculateFantasyPoints(computeScoringRating(compU));
    }

    if (gp === 0) continue;

    console.log(
      `${p.name.padEnd(16)} | ` +
      `${item.type.padEnd(20)} | ` +
      `${(sumA / gp).toFixed(1).padStart(5)} | ` +
      `${(sumI / gp).toFixed(1).padStart(5)} | ` +
      `${(sumQ / gp).toFixed(1).padStart(5)} | ` +
      `${(sumT / gp).toFixed(1).padStart(5)} | ` +
      `${(sumU / gp).toFixed(1).padStart(5)}`
    );
  }

})();
