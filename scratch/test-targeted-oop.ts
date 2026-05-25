import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating } from '../src/lib/scoring/matchRating';

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

// Capped clean sheet bonus helper
function getCappedCsBonus(primary: GranularPosition, slotted: GranularPosition, stats: RawStats): number {
    if (!stats.clean_sheet || stats.minutes_played < 60) return 0;
    
    const getBaseCs = (pos: GranularPosition) => {
        const group = getPositionGroup(pos);
        if (group === 'GK' || group === 'DEF' || pos === 'DM') return 12;
        if (pos === 'CM') return 4;
        return 0;
    };
    
    const primaryCs = getBaseCs(primary);
    const slottedCs = getBaseCs(slotted);
    
    // Cap clean sheet at the primary position's natural value
    return Math.min(primaryCs, slottedCs);
}

function calculateProposedRating(
    stats: RawStats,
    position: GranularPosition, // slotted position
    primaryPosition: GranularPosition, // actual real-life position
    refStats: Record<GranularPosition, ReferenceStats>,
    opts: {
        applyTargetedOop: boolean;
        penaltySize: number;
    }
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = refStats[position] ?? refStats.CM;

    // Apply Capped Clean Sheet Bonus
    const csBonus = opts.applyTargetedOop 
        ? getCappedCsBonus(primaryPosition, position, stats)
        : (() => {
            const csPosGroup = getPositionGroup(position);
            if (stats.clean_sheet && stats.minutes_played >= 60) {
                if (csPosGroup === 'GK' || csPosGroup === 'DEF' || position === 'DM') return 12;
                if (position === 'CM') return 4;
            }
            return 0;
          })();
    
    const xgc = stats.expected_goals_conceded ?? 0;
    const gc = stats.goals_conceded;
    const xgcOutperf = Math.max(0, xgc - gc) * 5;
    const gcPenalty = Math.max(0, gc - xgc) * 5;

    const tackles = Math.max(0, stats.fpl_tackles ?? 0);
    const cbi = Math.max(0, stats.fpl_cbi ?? 0);
    const recoveries = Math.max(0, stats.fpl_recoveries ?? 0);
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);

    let defActionsRaw: number;
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

    // TARGETED PENALTY RULE:
    // If player's primary role is an attacker/creative midfielder (AM, LW, RW, ST)
    // AND they are slotted in a defensive position (CB, LB, RB, LWB, RWB):
    let penaltyScale = 1.0;
    if (opts.applyTargetedOop) {
        const isAttacker = ['AM', 'LW', 'RW', 'ST'].includes(primaryPosition);
        const isSlottedDefender = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
        if (isAttacker && isSlottedDefender) {
            penaltyScale = 1.0 - opts.penaltySize;
        }
    }

    let rating = curveFinalRating(composite, stats.minutes_played);
    let scoringRating = 1.0 + 9.0 * composite;
    scoringRating = Math.max(1.0, Math.min(10.0, scoringRating));

    rating = rating * penaltyScale;
    let fantasyPoints = calculateFantasyPoints(scoringRating, stats.minutes_played);
    fantasyPoints = fantasyPoints * penaltyScale;

    return {
        rating: Math.round(rating * 10) / 10,
        fantasyPoints: Math.round(fantasyPoints * 10) / 10,
    };
}

async function testPlayer(pName: string, secRole: string, refStats: any, penaltySize: number) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position, secondary_positions')
      .ilike('name', `%${pName}%`);

    if (!players || players.length === 0) return;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) return;

    let gp = 0;
    let sumPtsPrimary = 0;
    let sumPtsSecBaseline = 0;
    let sumPtsSecTargeted = 0;

    for (const r of statsRows) {
        const mins = r.stats?.minutes_played ?? 0;
        if (mins === 0) continue;
        gp++;

        // Primary
        const prim = calculateProposedRating(r.stats as any, p.primary_position, p.primary_position, refStats, { applyTargetedOop: false, penaltySize: 0 });
        sumPtsPrimary += prim.fantasyPoints;

        // Secondary - Baseline
        const base = calculateProposedRating(r.stats as any, secRole as any, p.primary_position as any, refStats, { applyTargetedOop: false, penaltySize: 0 });
        sumPtsSecBaseline += base.fantasyPoints;

        // Secondary - Targeted (Capped CS + targeted penalty)
        const targ = calculateProposedRating(r.stats as any, secRole as any, p.primary_position as any, refStats, { applyTargetedOop: true, penaltySize });
        sumPtsSecTargeted += targ.fantasyPoints;
    }

    console.log(`Player: ${p.name} (Primary: ${p.primary_position}, Slotted: ${secRole})`);
    console.log(`  - As Primary (${p.primary_position}): PPG = ${(sumPtsPrimary / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${secRole}) - Current Baseline: PPG = ${(sumPtsSecBaseline / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${secRole}) - Targeted System (${(penaltySize * 100).toFixed(0)}% penalty + CS Cap): PPG = ${(sumPtsSecTargeted / gp).toFixed(1)}`);
    console.log(`--------------------------------------------------`);
}

(async () => {
  // Load reference stats
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

  console.log("=== TESTING TARGETED OOP SYSTEM WITH 15% PENALTY ===\n");
  await testPlayer("Szoboszlai", "RB", refStats, 0.15);
  await testPlayer("Szoboszlai", "CM", refStats, 0.15);
  await testPlayer("Buendia", "AM", refStats, 0.15);
  await testPlayer("Krejci", "CM", refStats, 0.15);
  await testPlayer("Bogarde", "RB", refStats, 0.15);

  console.log("\n=== TESTING TARGETED OOP SYSTEM WITH 20% PENALTY ===\n");
  await testPlayer("Szoboszlai", "RB", refStats, 0.20);
  await testPlayer("Szoboszlai", "CM", refStats, 0.20);
  await testPlayer("Buendia", "AM", refStats, 0.20);
  await testPlayer("Krejci", "CM", refStats, 0.20);
  await testPlayer("Bogarde", "RB", refStats, 0.20);

})();
