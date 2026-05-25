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
const SIGMOID_K = 1.0;

function sigmoidNormalize(value: number, median: number, stddev: number): number {
    if (stddev <= 0) return 0.5;
    const z = SIGMOID_K * (value - median) / stddev;
    return 1 / (1 + Math.exp(-z));
}

function simulateRating(
    stats: RawStats,
    position: 'DM' | 'CM',
    refStats: Record<GranularPosition, ReferenceStats>,
    weights: Record<string, number>,
    flexComponents: string[],
    xgcMultiplier: number,
    gcPenaltyCoeff: number
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = (refStats as any)[position];

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

    let maxScore = -1;
    let maxComponent = '';
    for (const key of flexComponents) {
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
            finalWeight += 0.25; // flex weight
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
  // Load fixtures for team GC lookup
  console.log("Fetching FPL fixtures...");
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
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  const players = [
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante", pos: "DM" },
    { name: "Declan Rice", pos: "DM" },
    { name: "Kobbie Mainoo", pos: "DM" },
    { name: "James Garner", pos: "DM" },
    { name: "Elliot Anderson", pos: "DM" }
  ];

  // Fetch player stats rows once to keep simulations fast
  const playerStatsRows: Record<string, { stats: any[], pl_team_id: number }> = {};
  for (const item of players) {
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, pl_team_id')
      .ilike('name', `%${item.name}%`);

    if (!dbPlayers || dbPlayers.length === 0) continue;
    const p = dbPlayers[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats, gameweek')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (statsRows && statsRows.length > 0) {
      playerStatsRows[p.name] = {
        stats: statsRows,
        pl_team_id: p.pl_team_id
      };
    }
  }

  // Weight Profiles to evaluate
  const WEIGHT_PROFILES = [
    {
      name: "Option C (Def 25, Infl 10, Crea 5, MI 30, GI 5)",
      DM: { match_impact: 0.30, influence: 0.10, creativity: 0.05, threat: 0.00, defensive: 0.25, goal_involvement: 0.05 },
      flex: ['match_impact', 'influence', 'defensive']
    },
    {
      name: "Refined Option D (Def 20, Infl 5, Crea 5, MI 40, GI 5) - Focus on BPS & Def Actions",
      DM: { match_impact: 0.40, influence: 0.05, creativity: 0.05, threat: 0.00, defensive: 0.20, goal_involvement: 0.05 },
      flex: ['match_impact', 'defensive']
    },
    {
      name: "Strict Control Profile (Def 25, Infl 0, Crea 0, MI 45, GI 5) - Kill set-piece inflation",
      DM: { match_impact: 0.45, influence: 0.00, creativity: 0.00, threat: 0.00, defensive: 0.25, goal_involvement: 0.05 },
      flex: ['match_impact', 'defensive']
    }
  ];

  // Parameters grid
  const GRID = [
    { xgcMult: 1.5, gcPenalty: 0.04 },
    { xgcMult: 1.0, gcPenalty: 0.02 },
    { xgcMult: 0.0, gcPenalty: 0.02 },
    { xgcMult: 0.0, gcPenalty: 0.00 },
    { xgcMult: 1.0, gcPenalty: 0.00 }
  ];

  for (const wp of WEIGHT_PROFILES) {
    console.log(`\n==================================================================`);
    console.log(`WEIGHT PROFILE: ${wp.name}`);
    console.log(`==================================================================`);

    for (const params of GRID) {
      console.log(`\n>>> Parameters: xgcMultiplier = ${params.xgcMult.toFixed(1)} | Composite Penalty = ${params.gcPenalty.toFixed(2)}`);
      
      for (const item of players) {
        const data = playerStatsRows[item.name] || playerStatsRows[item.name.replace("Rodrigo 'Rodri' Hernandez Cascante", "Rodrigo 'Rodri' Hernandez")];
        if (!data) continue;

        let gp = 0;
        let totalPts = 0, totalRat = 0;

        for (const r of data.stats) {
          const stats = r.stats as any;
          if (!stats || stats.minutes_played < 60) continue;
          gp++;

          const enrichedStats = { ...stats };
          if (data.pl_team_id) {
            const teamGc = fixtureGoalsConceded[`${r.gameweek}_${data.pl_team_id}`];
            if (teamGc !== undefined) {
              enrichedStats.goals_conceded = teamGc;
            }
          }

          const res = simulateRating(
            enrichedStats, 
            'DM', 
            refStats, 
            wp.DM, 
            wp.flex, 
            params.xgcMult, 
            params.gcPenalty
          );
          totalPts += res.fantasyPoints;
          totalRat += res.rating;
        }

        if (gp > 0) {
          console.log(`  - ${item.name.padEnd(35)} | Rating = ${(totalRat/gp).toFixed(2)} | PPG = ${(totalPts/gp).toFixed(1)}`);
        }
      }
    }
  }
})();
