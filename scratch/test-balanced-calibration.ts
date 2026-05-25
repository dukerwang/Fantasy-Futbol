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

// Option C Weights
const WEIGHTS = {
  DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 },
  CM: { match_impact: 0.25, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 }
};

const FLEX = {
  DM: { flex: 0.25, components: ['match_impact', 'influence', 'defensive'] },
  CM: { flex: 0.25, components: ['match_impact', 'creativity', 'influence'] }
};

function calculateRating(
    stats: RawStats,
    position: 'DM' | 'CM',
    refStats: Record<GranularPosition, ReferenceStats>,
    xgcMultiplier: number, // instead of 5
    gcPenaltyCoeff: number  // composite penalty
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
    
    // Scale xGC outperf and penalty by the custom multiplier
    const xgcOutperf = Math.max(0, xgc - gc) * xgcMultiplier;
    const gcPenalty = Math.max(0, gc - xgc) * xgcMultiplier;
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
        finishing: 0.5,
        save_score: 0.5,
    };

    const flexConfig = FLEX[position];

    let maxScore = -1;
    let maxComponent = '';
    for (const key of flexConfig.components) {
        if (scores[key] > maxScore) {
            maxScore = scores[key];
            maxComponent = key;
        }
    }

    let composite = 0;
    for (const key of Object.keys(WEIGHTS[position])) {
        const weight = (WEIGHTS[position] as any)[key];
        let finalWeight = weight;
        if (key === maxComponent) {
            finalWeight += flexConfig.flex;
        }
        if (finalWeight === 0) continue;
        composite += scores[key] * finalWeight;
    }

    composite = Math.min(1.0, composite);

    // Apply composite level goals conceded penalty
    if (gcPenaltyCoeff > 0) {
      composite = Math.max(0, composite - (gc * gcPenaltyCoeff));
    }

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
  const fixtureGoalsConceded: Record<string, number> = {};
  
  for (let gw = 1; gw <= 35; gw++) {
    try {
      const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`);
      if (!res.ok) continue;
      const fixtures = await res.json() as any[];
      for (const f of fixtures) {
        if (f.team_h_score !== null && f.team_h_score !== undefined && f.team_a_score !== null && f.team_a_score !== undefined) {
          fixtureGoalsConceded[`${gw}_${f.team_h}`] = f.team_a_score;
          fixtureGoalsConceded[`${gw}_${f.team_a}`] = f.team_h_score;
        }
      }
    } catch (e) {}
  }

  // Load Reference Stats
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
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", pos: "DM" },
    { name: "Declan Rice", pos: "DM" },
    { name: "James Garner", pos: "DM" },
    { name: "Elliot Anderson", pos: "DM" },
  ];

  // We will test 3 configurations:
  // Config 1: xGC Multiplier = 2.0, Composite Penalty = 0.00
  // Config 2: xGC Multiplier = 2.0, Composite Penalty = 0.02
  // Config 3: xGC Multiplier = 3.0, Composite Penalty = 0.00
  // Config 4: xGC Multiplier = 3.0, Composite Penalty = 0.01

  const configs = [
    { name: "Config A (xGC Mult = 2.0, Comp Coeff = 0.00)", xgcMult: 2.0, compCoeff: 0.00 },
    { name: "Config B (xGC Mult = 2.0, Comp Coeff = 0.02)", xgcMult: 2.0, compCoeff: 0.02 },
    { name: "Config C (xGC Mult = 3.0, Comp Coeff = 0.00)", xgcMult: 3.0, compCoeff: 0.00 },
    { name: "Config D (xGC Mult = 3.0, Comp Coeff = 0.01)", xgcMult: 3.0, compCoeff: 0.01 },
  ];

  for (const conf of configs) {
    console.log(`\n=== SIMULATING: ${conf.name} ===\n`);
    
    for (const item of players) {
      const { data: dbPlayers } = await supabase
        .from('players')
        .select('id, name, pl_team_id')
        .ilike('name', `%${item.name}%`);

      if (!dbPlayers || dbPlayers.length === 0) continue;
      const p = dbPlayers[0];
      const pos = item.pos as 'DM' | 'CM';

      const { data: statsRows } = await supabase
        .from('player_stats')
        .select('stats, gameweek')
        .eq('player_id', p.id)
        .not('stats', 'is', null);

      if (!statsRows || statsRows.length === 0) continue;

      let gp = 0;
      let totalPts = 0, totalRat = 0;

      for (const r of statsRows) {
        const stats = r.stats as any;
        if (!stats || stats.minutes_played < 45) continue;
        gp++;

        const enrichedStats = { ...stats };
        if (p.pl_team_id) {
          const teamGc = fixtureGoalsConceded[`${r.gameweek}_${p.pl_team_id}`];
          if (teamGc !== undefined) {
            enrichedStats.goals_conceded = teamGc;
          }
        }

        const res = calculateRating(enrichedStats, pos, refStats, conf.xgcMult, conf.compCoeff);
        totalPts += res.fantasyPoints;
        totalRat += res.rating;
      }

      console.log(`Player: ${p.name.padEnd(30)} | Rating = ${(totalRat/gp).toFixed(2)} | PPG = ${(totalPts/gp).toFixed(1)}`);
    }
  }
})();
