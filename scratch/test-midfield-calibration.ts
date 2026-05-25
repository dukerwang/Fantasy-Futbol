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

function simulatePositionRating(
    stats: RawStats,
    position: 'DM' | 'CM',
    refStats: Record<GranularPosition, ReferenceStats>,
    weights: Record<string, number>,
    flexComponents: string[]
) {
    if (stats.minutes_played === 0) return { rating: 0, fantasyPoints: 0 };

    const ref = (refStats as any)[position];

    // Clean sheet bonus
    let csBonus = 0;
    if (stats.clean_sheet && stats.minutes_played >= 60) {
        if (position === 'DM') {
            csBonus = 12;
        } else if (position === 'CM') {
            csBonus = 4;
        }
    }
    
    // Midfielders have xgcMultiplier = 0 (no keeper luck)
    const dc = Math.max(0, stats.fpl_def_contrib ?? 0);
    const defensiveRaw = dc + csBonus;

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
            finalWeight += 0.25; // Flex weight
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
  // Load fixtures
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
    { name: "Declan Rice" },
    { name: "James Garner" },
    { name: "Elliot Anderson" },
    { name: "Moisés Caicedo" },
    { name: "Rodrigo 'Rodri' Hernandez Cascante" }
  ];

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

  // Define candidate weight combinations to test
  const CANDIDATES = [
    {
      name: "Current System (Refined Option D)",
      DM: { match_impact: 0.40, defensive: 0.20, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive'],
      CM: { match_impact: 0.25, defensive: 0.20, goal_involvement: 0.10, influence: 0.05, creativity: 0.15 },
      CM_flex: ['match_impact', 'creativity', 'influence']
    },
    {
      name: "Candidate 1: DM Defensive Boost + DM Creativity/Influence Flex",
      // DM gets a solid defensive weight and is allowed to flex into creativity or influence so their big creative games aren't nerfed.
      // CM defensive weight is slightly reduced to 0.15 (reflecting real expectation) and goal involvement raised to 0.10.
      DM: { match_impact: 0.35, defensive: 0.25, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive', 'creativity', 'influence'],
      CM: { match_impact: 0.25, defensive: 0.15, goal_involvement: 0.10, influence: 0.10, creativity: 0.15 },
      CM_flex: ['match_impact', 'creativity', 'influence', 'defensive']
    },
    {
      name: "Candidate 2: DM Creativity Boost + Restricted CM Defensive",
      // Raising DM base weights for creativity to 0.10, and allowing DM to flex into creativity or influence.
      // Reducing CM base defensive weight to 0.10 to prevent high-tackling players from getting a massive defensive boost as CM.
      DM: { match_impact: 0.30, defensive: 0.25, goal_involvement: 0.05, influence: 0.05, creativity: 0.10 },
      DM_flex: ['match_impact', 'defensive', 'creativity'],
      CM: { match_impact: 0.25, defensive: 0.10, goal_involvement: 0.10, influence: 0.10, creativity: 0.20 },
      CM_flex: ['match_impact', 'creativity', 'influence']
    },
    {
      name: "Candidate 3: Balanced Symmetrical (Recommended)",
      // Symmetrical and highly elegant.
      // DM: Match Impact 0.35, Defensive 0.25, Goal Inv 0.05, Influence 0.05, Creativity 0.05
      //     Flexes in Match Impact, Defensive, or Creativity.
      // CM: Match Impact 0.25, Defensive 0.15, Goal Inv 0.10, Influence 0.10, Creativity 0.15
      //     Flexes in Match Impact, Defensive, or Creativity.
      DM: { match_impact: 0.35, defensive: 0.25, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive', 'creativity'],
      CM: { match_impact: 0.25, defensive: 0.15, goal_involvement: 0.10, influence: 0.10, creativity: 0.15 },
      CM_flex: ['match_impact', 'defensive', 'creativity']
    },
    {
      name: "Candidate 4: Dual-Position Equalizer",
      // DM: Match Impact 0.30, Defensive 0.30, Goal Inv 0.05, Influence 0.05, Creativity 0.05
      // CM: Match Impact 0.25, Defensive 0.15, Goal Inv 0.10, Influence 0.10, Creativity: 0.15
      DM: { match_impact: 0.30, defensive: 0.30, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive', 'creativity'],
      CM: { match_impact: 0.25, defensive: 0.15, goal_involvement: 0.10, influence: 0.05, creativity: 0.20 },
      CM_flex: ['match_impact', 'creativity', 'influence', 'defensive']
    },
    {
      name: "Candidate 5: Ultra-Balanced Equalizer",
      // Raises CM base match_impact to 0.30 and lowers base creativity to 0.10.
      // This reduces corner-crossing base-weight inflation.
      DM: { match_impact: 0.35, defensive: 0.25, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive', 'creativity'],
      CM: { match_impact: 0.30, defensive: 0.15, goal_involvement: 0.10, influence: 0.10, creativity: 0.10 },
      CM_flex: ['match_impact', 'defensive', 'creativity']
    },
    {
      name: "Candidate 6: Deep Symmetrical Equalizer",
      // Keeps base influence at 0.05 for both.
      DM: { match_impact: 0.35, defensive: 0.25, goal_involvement: 0.05, influence: 0.05, creativity: 0.05 },
      DM_flex: ['match_impact', 'defensive', 'creativity'],
      CM: { match_impact: 0.30, defensive: 0.15, goal_involvement: 0.10, influence: 0.05, creativity: 0.15 },
      CM_flex: ['match_impact', 'defensive', 'creativity']
    }
  ];

  for (const cand of CANDIDATES) {
    console.log(`\n====================================================================================`);
    console.log(`EVALUATING CANDIDATE: ${cand.name}`);
    console.log(`====================================================================================`);
    
    let totalGap = 0;
    
    for (const item of players) {
      const data = playerStatsRows[item.name] || playerStatsRows[item.name.replace("Rodrigo 'Rodri' Hernandez Cascante", "Rodrigo 'Rodri' Hernandez")];
      if (!data) continue;

      let gp = 0;
      let dmPts = 0, dmRat = 0;
      let cmPts = 0, cmRat = 0;

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

        // Run as DM
        const resDM = simulatePositionRating(enrichedStats, 'DM', refStats, cand.DM, cand.DM_flex);
        dmPts += resDM.fantasyPoints;
        dmRat += resDM.rating;

        // Run as CM
        const resCM = simulatePositionRating(enrichedStats, 'CM', refStats, cand.CM, cand.CM_flex);
        cmPts += resCM.fantasyPoints;
        cmRat += resCM.rating;
      }

      if (gp > 0) {
        const avgDmPpg = dmPts / gp;
        const avgCmPpg = cmPts / gp;
        const avgDmRat = dmRat / gp;
        const avgCmRat = cmRat / gp;
        const ppgGap = avgCmPpg - avgDmPpg;
        
        totalGap += Math.abs(ppgGap);
        
        console.log(`  - ${item.name.padEnd(35)}:`);
        console.log(`    * DM: Rating = ${avgDmRat.toFixed(2)} | PPG = ${avgDmPpg.toFixed(1)}`);
        console.log(`    * CM: Rating = ${avgCmRat.toFixed(2)} | PPG = ${avgCmPpg.toFixed(1)}`);
        console.log(`    * Gap = ${ppgGap.toFixed(2)} PPG`);
      }
    }
    
    console.log(`\n  >>> TOTAL ABSOLUTE PPG GAP = ${totalGap.toFixed(2)} PPG`);
  }
})();
