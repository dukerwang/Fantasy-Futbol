import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Custom lightweight env loader for .env.local
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  console.error("Failed to load .env.local manually:", e);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

import { 
  DEFAULT_REFERENCE_STATS, 
  POSITION_WEIGHTS, 
  FLEX_CONFIG, 
  getPositionGroup,
  curveFinalRating,
  calculateFantasyPoints
} from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats, ReferenceStats, RatingComponent } from '@/types';

type ComponentScores = Record<RatingComponent, number>;

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

// Map position groups to integers
const GROUP_INDEX = {
    GK: 0,
    DEF: 1,
    MID: 2,
    ATT: 3,
};

function calculateOopPenalty(primary: GranularPosition, slotted: GranularPosition, penaltyPerStep: number = 0.15): number {
    if (primary === slotted) return 1.0;
    
    const pGroup = getPositionGroup(primary);
    const sGroup = getPositionGroup(slotted);
    
    // If either is GK and they don't match, apply a severe flat 50% penalty
    if ((pGroup === 'GK' || sGroup === 'GK') && pGroup !== sGroup) {
        return 0.50; // 50% penalty
    }
    
    const pIdx = GROUP_INDEX[pGroup];
    const sIdx = GROUP_INDEX[sGroup];
    const distance = Math.abs(pIdx - pIdx); // Wait, typo in original logic: pIdx - pIdx would be 0! It should be Math.abs(pIdx - sIdx).
    const actualDistance = Math.abs(pIdx - sIdx);
    
    return Math.max(0.10, 1.0 - (actualDistance * penaltyPerStep));
}

function calculateProposedRating(
    stats: RawStats,
    position: GranularPosition, // slotted position
    primaryPosition: GranularPosition, // actual real-life position
    refStats: Record<GranularPosition, ReferenceStats>,
    opts: {
        penaltyPerStep: number;
    }
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    // 1. Normalization is always done against the slotted position's reference stats
    const ref = refStats[position] ?? refStats.CM;

    // 2. Clean Sheet Bonus is locked to the player's primary position group
    const csPosition = primaryPosition;
    const csPosGroup = getPositionGroup(csPosition);
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (csPosGroup === 'GK' || csPosGroup === 'DEF' || csPosition === 'DM') {
            csBonus = 12;
        } else if (csPosition === 'CM') {
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
    // Defensive actions calculation should match the slotted position (what their role is in the slot)
    if (position === 'GK') {
        defActionsRaw = 0;
    } else if (position === 'CB') {
        defActionsRaw = tackles + cbi * 0.5;
    } else if (position === 'LB' || position === 'RB' || position === 'LWB' || position === 'RWB') {
        defActionsRaw = dc + recoveries * 0.5;
    } else {
        defActionsRaw = dc;
    }

    const defensiveRaw = defActionsRaw + csBonus + xgcOutperf - gcPenalty;

    // 3. Compute components
    const rawBps = stats.bps ?? 0;
    const goalAssistBps = stats.goals * 12 + stats.assists * 9;
    const adjustedBps = Math.max(0, rawBps - goalAssistBps);

    const scores: ComponentScores = {
        match_impact: sigmoidNormalize(adjustedBps, ref.match_impact.median, ref.match_impact.stddev),
        influence: sigmoidNormalize(stats.influence ?? 0, ref.influence.median, ref.influence.stddev),
        creativity: sigmoidNormalize(stats.creativity ?? 0, ref.creativity.median, ref.creativity.stddev),
        threat: sigmoidNormalize(stats.threat ?? 0, ref.threat.median, ref.threat.stddev),
        defensive: sigmoidNormalize(defensiveRaw, ref.defensive.median, ref.defensive.stddev),
        goal_involvement: sigmoidNormalize(stats.goals * 6 + stats.assists * 4, GLOBAL_GI_MEDIAN, GLOBAL_GI_STDDEV),
        finishing: sigmoidNormalize((stats.goals - (stats.expected_goals ?? 0)) + ((stats.assists - (stats.expected_assists ?? 0)) * 0.5), GLOBAL_FINISHING_MEDIAN, GLOBAL_FINISHING_STDDEV),
        save_score: position === 'GK' ? sigmoidNormalize(stats.saves * 2 - Math.max(0, gc - xgc) * 2, ref.save_score.median, ref.save_score.stddev) : 0.5,
    };

    // 4. Weights are based on the slotted position
    const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
    const flexConfig = FLEX_CONFIG[position] || FLEX_CONFIG.CM;

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
        const weight = weights[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        if (finalWeight === 0) continue;
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

    // Apply the position group distance penalty
    const pGroup = getPositionGroup(primaryPosition);
    const sGroup = getPositionGroup(position);
    let penaltyScale = 1.0;
    if (pGroup !== sGroup) {
        const pIdx = GROUP_INDEX[pGroup];
        const sIdx = GROUP_INDEX[sGroup];
        const distance = Math.abs(pIdx - sIdx);
        penaltyScale = Math.max(0.10, 1.0 - (distance * opts.penaltyPerStep));
    }

    // Step 3 & 4
    let rating = curveFinalRating(composite, stats.minutes_played);
    let scoringRating = 1.0 + 9.0 * composite;
    scoringRating = Math.max(1.0, Math.min(10.0, scoringRating));

    // Apply penalty scale
    rating = rating * penaltyScale;
    let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);
    fantasyPoints = fantasyPoints * penaltyScale;

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(fantasyPoints * 10) / 10,
    };
}

(async () => {
  // Fetch Szoboszlai
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  if (!players || players.length === 0) {
    console.error("Could not find Szoboszlai");
    return;
  }
  const p = players[0];

  // Fetch reference stats
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

  // Fetch stats rows
  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null);

  if (!statsRows) {
    console.error("No stats found");
    return;
  }

  const penaltySteps = [0.10, 0.12, 0.15, 0.20];

  console.log(`Proposed System: Slotted Normalization + Primary CS Bonus + Distance Penalty`);
  console.log(`Evaluating Szoboszlai (Primary AM) across different penalty step sizes:\n`);

  for (const step of penaltySteps) {
    console.log(`--- Penalty Step: ${(step * 100).toFixed(0)}% per group distance step ---`);
    for (const role of ['AM', 'CM', 'RB']) {
        let gp = 0, pts = 0, rat = 0;
        for (const r of statsRows) {
            const mins = r.stats?.minutes_played ?? 0;
            if (mins === 0) continue;
            
            const calc = calculateProposedRating(r.stats as any, role as any, p.primary_position as any, refStats, { penaltyPerStep: step });
            gp++;
            pts += calc.fantasyPoints;
            rat += calc.rating;
        }
        console.log(`  As ${role}: ${gp} GP, Avg Rating: ${(rat / gp).toFixed(2)}, PPG: ${(pts / gp).toFixed(1)}`);
    }
  }

})();
