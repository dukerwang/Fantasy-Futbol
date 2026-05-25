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

const GROUP_INDEX = {
    GK: 0,
    DEF: 1,
    MID: 2,
    ATT: 3,
};

function calculateProposedRating(
    stats: RawStats,
    position: GranularPosition, // slotted position
    primaryPosition: GranularPosition, // actual real-life position
    refStats: Record<GranularPosition, ReferenceStats>,
    opts: {
        lockCsToPrimary: boolean;
        penaltyPerStep: number;
    }
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = refStats[position] ?? refStats.CM;

    // CS bonus logic
    const csPosition = opts.lockCsToPrimary ? primaryPosition : position;
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

(async () => {
  // Fetch active players who have secondary positions
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .eq('is_active', true)
    .not('secondary_positions', 'is', null);

  if (!players) {
    console.error("No players found");
    return;
  }

  // Filter players whose secondary position groups are different from their primary position groups
  const oopPlayers = players.filter(p => {
    const pGroup = getPositionGroup(p.primary_position);
    return (p.secondary_positions || []).some(sec => {
        const sGroup = getPositionGroup(sec);
        return pGroup !== sGroup;
    });
  });

  console.log(`Found ${oopPlayers.length} players with secondary positions in a different position group.\n`);

  // Let's load reference stats
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

  // Select 8 interesting players to analyze (e.g. fullbacks playing in midfield, wingers in midfield, etc.)
  const selectedPlayers = oopPlayers.slice(0, 8);

  for (const p of selectedPlayers) {
    // Find their secondary positions that belong to a different group
    const pGroup = getPositionGroup(p.primary_position);
    const targetSecondary = p.secondary_positions.find(sec => getPositionGroup(sec) !== pGroup);
    if (!targetSecondary) continue;

    // Fetch player stats
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    console.log(`Player: ${p.name} (Primary: ${p.primary_position} [${pGroup}], Evaluated Secondary: ${targetSecondary} [${getPositionGroup(targetSecondary)}])`);
    console.log(`Stats sample: ${statsRows.length} appearances`);

    // Run evaluations
    let gp = 0;
    let sumPtsPrimary = 0;
    let sumPtsSecBaseline = 0;
    let sumPtsSecOptA = 0; // Lock CS only
    let sumPtsSecOptB = 0; // Lock CS + 10% penalty

    for (const r of statsRows) {
        const mins = r.stats?.minutes_played ?? 0;
        if (mins === 0) continue;
        gp++;

        // 1. Primary
        const prim = calculateProposedRating(r.stats as any, p.primary_position, p.primary_position, refStats, { lockCsToPrimary: false, penaltyPerStep: 0 });
        sumPtsPrimary += prim.fantasyPoints;

        // 2. Secondary - Baseline
        const base = calculateProposedRating(r.stats as any, targetSecondary, p.primary_position, refStats, { lockCsToPrimary: false, penaltyPerStep: 0 });
        sumPtsSecBaseline += base.fantasyPoints;

        // 3. Secondary - Lock CS only
        const optA = calculateProposedRating(r.stats as any, targetSecondary, p.primary_position, refStats, { lockCsToPrimary: true, penaltyPerStep: 0 });
        sumPtsSecOptA += optA.fantasyPoints;

        // 4. Secondary - Lock CS + 10% penalty
        const optB = calculateProposedRating(r.stats as any, targetSecondary, p.primary_position, refStats, { lockCsToPrimary: true, penaltyPerStep: 0.10 });
        sumPtsSecOptB += optB.fantasyPoints;
    }

    if (gp === 0) continue;

    console.log(`  - As Primary (${p.primary_position}): PPG = ${(sumPtsPrimary / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${targetSecondary}) - Current Baseline: PPG = ${(sumPtsSecBaseline / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${targetSecondary}) - CS Locked: PPG = ${(sumPtsSecOptA / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${targetSecondary}) - CS Locked + 10% OOP Penalty: PPG = ${(sumPtsSecOptB / gp).toFixed(1)}`);
    console.log(`--------------------------------------------------`);
  }

})();
