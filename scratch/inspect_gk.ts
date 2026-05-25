import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, pl_team, primary_position')
    .in('name', ['David Raya', 'Mads Hermansen']);

  console.log("Players found:", players);

  for (const p of players || []) {
    const { data: stats } = await supabase
      .from('player_stats')
      .select('gameweek, stats, match_rating_v2, fantasy_points_v2')
      .eq('player_id', p.id)
      .order('gameweek', { ascending: true });

    console.log(`\n=== Stats for ${p.name} (${p.pl_team}) ===`);
    const rows = (stats || [])
      .filter(s => (s.stats.minutes_played ?? 0) >= 45)
      .map(s => {
        return {
          GW: s.gameweek,
          Mins: s.stats.minutes_played,
          Saves: s.stats.saves ?? 0,
          CS: s.stats.clean_sheet,
          GC: s.stats.goals_conceded ?? 0,
          BPS: s.stats.bps ?? 0,
          Rating_V2: s.match_rating_v2,
          Points_V2: s.fantasy_points_v2
        };
      });
    console.table(rows);
    
    const totalPoints = rows.reduce((sum, r) => sum + (r.Points_V2 ?? 0), 0);
    const avgPoints = totalPoints / rows.length;
    console.log(`Total Matches (>=45 mins): ${rows.length}`);
    console.log(`Total V2 Points: ${totalPoints.toFixed(2)}`);
    console.log(`PPG: ${avgPoints.toFixed(2)}`);
  }
}

main().catch(console.error);
