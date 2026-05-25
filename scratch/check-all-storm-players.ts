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
  curveFinalRating,
  calculateFantasyPoints,
  getPositionGroup
} from '../src/lib/scoring/matchRating';
import type { GranularPosition, RawStats } from '@/types';

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
    
    return Math.min(primaryCs, slottedCs);
}

function calculateProposedRating(
    stats: RawStats,
    position: GranularPosition, // slotted position
    primaryPosition: GranularPosition, // actual real-life position
    refStats: any,
    opts: {
        applyCsCap: boolean;
        penaltySize: number;
    }
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = refStats[position] ?? refStats.CM;

    // Apply Capped Clean Sheet Bonus
    const csBonus = opts.applyCsCap
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

    const scores: any = {
        match_impact: 1 / (1 + Math.exp(-(adjustedBps - ref.match_impact.median) / ref.match_impact.stddev)),
        influence: 1 / (1 + Math.exp(-(stats.influence - ref.influence.median) / ref.influence.stddev)),
        creativity: 1 / (1 + Math.exp(-(stats.creativity - ref.creativity.median) / ref.creativity.stddev)),
        threat: 1 / (1 + Math.exp(-(stats.threat - ref.threat.median) / ref.threat.stddev)),
        defensive: 1 / (1 + Math.exp(-(defensiveRaw - ref.defensive.median) / ref.defensive.stddev)),
        goal_involvement: 1 / (1 + Math.exp(-(stats.goals * 6 + stats.assists * 4 - 0) / 2.5)),
        finishing: 1 / (1 + Math.exp(-((stats.goals - (stats.expected_goals ?? 0)) + ((stats.assists - (stats.expected_assists ?? 0)) * 0.5) - (-0.03)) / 0.28)),
        save_score: position === 'GK' ? 1 / (1 + Math.exp(-(stats.saves * 2 - Math.max(0, gc - xgc) * 2 - ref.save_score.median) / ref.save_score.stddev)) : 0.5,
    };

    const POSITION_WEIGHTS: any = {
        GK: { match_impact: 0.25, influence: 0.20, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.00, finishing: 0.00, save_score: 0.10 },
        CB: { match_impact: 0.30, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.20, finishing: 0.05, save_score: 0.00 },
        LB: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
        RB: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
        DM: { match_impact: 0.30, influence: 0.25, creativity: 0.05, threat: 0.00, defensive: 0.10, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
        CM: { match_impact: 0.20, influence: 0.15, creativity: 0.15, threat: 0.10, defensive: 0.05, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
        LWB: { match_impact: 0.15, influence: 0.05, creativity: 0.20, threat: 0.05, defensive: 0.10, goal_involvement: 0.20, finishing: 0.00, save_score: 0.00 },
        RWB: { match_impact: 0.15, influence: 0.05, creativity: 0.20, threat: 0.05, defensive: 0.10, goal_involvement: 0.20, finishing: 0.00, save_score: 0.00 },
        AM: { match_impact: 0.10, influence: 0.10, creativity: 0.25, threat: 0.15, defensive: 0.00, goal_involvement: 0.15, finishing: 0.00, save_score: 0.00 },
        LW: { match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00 },
        RW: { match_impact: 0.10, influence: 0.05, creativity: 0.10, threat: 0.05, defensive: 0.05, goal_involvement: 0.20, finishing: 0.20, save_score: 0.00 },
        ST: { match_impact: 0.10, influence: 0.10, creativity: 0.05, threat: 0.25, defensive: 0.00, goal_involvement: 0.15, finishing: 0.10, save_score: 0.00 },
    };

    const FLEX_CONFIG: any = {
        GK: { flex: 0.20, components: ['save_score', 'defensive'] },
        CB: { flex: 0.25, components: ['defensive', 'match_impact', 'goal_involvement'] },
        LB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
        RB: { flex: 0.25, components: ['creativity', 'match_impact', 'defensive'] },
        DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
        CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] },
        LWB: { flex: 0.20, components: ['creativity', 'goal_involvement'] },
        RWB: { flex: 0.20, components: ['creativity', 'goal_involvement'] },
        AM: { flex: 0.25, components: ['creativity', 'goal_involvement', 'finishing'] },
        LW: { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat'] },
        RW: { flex: 0.25, components: ['goal_involvement', 'finishing', 'threat'] },
        ST: { flex: 0.25, components: ['threat', 'goal_involvement', 'finishing'] },
    };

    const weights = POSITION_WEIGHTS[position] || POSITION_WEIGHTS.CM;
    const flexConfig = FLEX_CONFIG[position] || FLEX_CONFIG.CM;

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

    // OOP penalty
    let penaltyScale = 1.0 - opts.penaltySize;

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
    { name: "Amad Diallo", sec: "RWB" },
    { name: "Patrick Dorgu", sec: "LWB" },
    { name: "Bendito Mantato", sec: "LB" },
    { name: "John McGinn", sec: "RWB" },
    { name: "Dominik Szoboszlai", sec: "RB" }
  ];

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumPtsPrimary = 0;
    let sumPtsSecBaseline = 0;
    
    // Test combinations
    let sumPtsCsCapOnly = 0;
    let sumPtsCsCap10Pct = 0;
    let sumPtsCsCap20Pct = 0;

    for (const r of statsRows) {
      const mins = r.stats?.minutes_played ?? 0;
      if (mins === 0) continue;
      gp++;

      // Primary
      const prim = calculateProposedRating(r.stats as any, p.primary_position as any, p.primary_position as any, refStats, { applyCsCap: false, penaltySize: 0 });
      sumPtsPrimary += prim.fantasyPoints;

      // Baseline
      const base = calculateProposedRating(r.stats as any, item.sec as any, p.primary_position as any, refStats, { applyCsCap: false, penaltySize: 0 });
      sumPtsSecBaseline += base.fantasyPoints;

      // Capped CS ONLY
      const csCap = calculateProposedRating(r.stats as any, item.sec as any, p.primary_position as any, refStats, { applyCsCap: true, penaltySize: 0 });
      sumPtsCsCapOnly += csCap.fantasyPoints;

      // Capped CS + 10% penalty
      const cs10 = calculateProposedRating(r.stats as any, item.sec as any, p.primary_position as any, refStats, { applyCsCap: true, penaltySize: 0.10 });
      sumPtsCsCap10Pct += cs10.fantasyPoints;

      // Capped CS + 20% penalty
      const cs20 = calculateProposedRating(r.stats as any, item.sec as any, p.primary_position as any, refStats, { applyCsCap: true, penaltySize: 0.20 });
      sumPtsCsCap20Pct += cs20.fantasyPoints;
    }

    if (gp === 0) continue;

    console.log(`Player: ${p.name}`);
    console.log(`  - As Primary (${p.primary_position}): PPG = ${(sumPtsPrimary / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${item.sec}) - CURRENT BASELINE: PPG = ${(sumPtsSecBaseline / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${item.sec}) - CS Cap ONLY (No Penalty): PPG = ${(sumPtsCsCapOnly / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${item.sec}) - CS Cap + 10% Penalty: PPG = ${(sumPtsCsCap10Pct / gp).toFixed(1)}`);
    console.log(`  - As Secondary (${item.sec}) - CS Cap + 20% Penalty: PPG = ${(sumPtsCsCap20Pct / gp).toFixed(1)}`);
    console.log(`--------------------------------------------------`);
  }
})();
