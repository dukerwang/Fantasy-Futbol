import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

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

(async () => {
  console.log("Fetching FPL fixtures for goals conceded enrichment...");
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
    { name: "Kobbie Mainoo", pos: "DM" },
    { name: "James Garner", pos: "DM" },
    { name: "Elliot Anderson", pos: "DM" }
  ];

  console.log("\n=== VERIFYING LIVE CALIBRATION VALUES IN CODEBASE (DM REF WEIGHTS) ===\n");

  for (const item of players) {
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, primary_position, pl_team_id')
      .ilike('name', `%${item.name}%`);

    if (!dbPlayers || dbPlayers.length === 0) continue;
    const p = dbPlayers[0];

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
      if (!stats || stats.minutes_played < 60) continue;
      gp++;

      const enrichedStats = { ...stats };
      if (p.pl_team_id) {
        const teamGc = fixtureGoalsConceded[`${r.gameweek}_${p.pl_team_id}`];
        if (teamGc !== undefined) {
          enrichedStats.goals_conceded = teamGc;
        }
      }

      // Run live calculateMatchRating
      const res = calculateMatchRating(enrichedStats, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      totalPts += res.fantasyPoints;
      totalRat += res.rating;
    }

    console.log(`Player: ${p.name.padEnd(35)} (${p.primary_position}) | Games: ${gp} | Rating = ${(totalRat/gp).toFixed(2)} | PPG = ${(totalPts/gp).toFixed(1)}`);
  }
})();
