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
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  if (!players || players.length === 0) {
    console.error("Could not find Szoboszlai");
    return;
  }
  const p = players[0];

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

  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('gameweek, stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null)
    .order('gameweek', { ascending: true });

  if (!statsRows || statsRows.length === 0) {
     console.log("No stats rows found");
     return;
  }

  // Find a gameweek where he played well and Liverpool kept a clean sheet
  const goodGws = statsRows.filter(r => (r.stats?.minutes_played ?? 0) >= 60 && r.stats?.clean_sheet && (r.stats?.creativity ?? 0) > 20);
  const selected = goodGws[0] || statsRows[0];

  console.log(`=== DETAILED BREAKDOWN COMPARISON FOR GW ${selected.gameweek} ===`);
  console.log(`Minutes Played: ${selected.stats.minutes_played}`);
  console.log(`Raw Stats: Creativity=${selected.stats.creativity}, BPS=${selected.stats.bps}, Goals=${selected.stats.goals}, Assists=${selected.stats.assists}, Clean Sheet=${selected.stats.clean_sheet}`);

  const amCalc = calculateMatchRating(selected.stats as any, 'AM', refStats);
  const rbCalc = calculateMatchRating(selected.stats as any, 'RB', refStats);

  console.log(`\n--- EVALUATED AS AM ---`);
  console.log(`Final Rating: ${amCalc.rating}, Points: ${amCalc.fantasyPoints}`);
  console.log(`Breakdown:`);
  for (const item of amCalc.breakdown) {
    console.log(`  - ${item.component} (${item.key}): Score=${item.score.toFixed(2)}, Final Weight=${item.weight.toFixed(2)}, Weighted=${item.weighted.toFixed(2)}, Detail="${item.detail}"`);
  }

  console.log(`\n--- EVALUATED AS RB ---`);
  console.log(`Final Rating: ${rbCalc.rating}, Points: ${rbCalc.fantasyPoints}`);
  console.log(`Breakdown:`);
  for (const item of rbCalc.breakdown) {
    console.log(`  - ${item.component} (${item.key}): Score=${item.score.toFixed(2)}, Final Weight=${item.weight.toFixed(2)}, Weighted=${item.weighted.toFixed(2)}, Detail="${item.detail}"`);
  }

})();
