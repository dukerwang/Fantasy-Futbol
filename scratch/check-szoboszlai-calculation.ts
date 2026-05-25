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

(async () => {
  // 1. Fetch Dominik Szoboszlai
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  if (!players || players.length === 0) {
    console.error("Could not find Szoboszlai");
    return;
  }

  const p = players[0];
  console.log(`Found Player: ${p.name} (ID: ${p.id})`);
  console.log(`Primary Position: ${p.primary_position}`);
  console.log(`Secondary Positions: ${JSON.stringify(p.secondary_positions)}`);

  // 2. Fetch reference stats
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
  }

  // 3. Fetch player stats
  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('id, gameweek, match_rating, match_rating_v2, fantasy_points, fantasy_points_v2, stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null);

  if (!statsRows) {
    console.error("No stats found");
    return;
  }

  const positionsToTest = [p.primary_position, ...(p.secondary_positions || [])];

  console.log(`\n=== SEASON SUMMARY ACROSS TESTED ROLES ===`);
  for (const pos of positionsToTest) {
    let gp = 0;
    let pointsSum = 0;
    let ratingSum = 0;

    for (const r of statsRows) {
      const mins = r.stats?.minutes_played ?? 0;
      if (mins === 0) continue; // DNP

      const calc = calculateMatchRating(r.stats as any, pos as any, refStats);
      gp++;
      pointsSum += calc.fantasyPoints;
      ratingSum += calc.rating;
    }

    console.log(`As ${pos}: ${gp} GP, Avg Rating: ${(ratingSum / gp).toFixed(2)}, PPG: ${(pointsSum / gp).toFixed(1)}`);
  }

})();
