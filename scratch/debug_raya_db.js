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
    .eq('name', 'David Raya');

  if (!players || players.length === 0) {
    console.log("Raya not found");
    return;
  }

  const raya = players[0];
  const { data: stats } = await supabase
    .from('player_stats')
    .select('gameweek, stats, match_rating, fantasy_points, match_rating_v2, fantasy_points_v2')
    .eq('player_id', raya.id)
    .order('gameweek', { ascending: true });

  console.log(`=== DAVID RAYA DB STATS AND RATINGS ===`);
  console.table(stats.slice(0, 10).map(s => ({
    GW: s.gameweek,
    Minutes: s.stats.minutes_played,
    Saves: s.stats.saves,
    CS: s.stats.clean_sheet,
    'V1 Rating': s.match_rating,
    'V1 Points': s.fantasy_points,
    'V2 Rating': s.match_rating_v2,
    'V2 Points': s.fantasy_points_v2,
  })));
}

main().catch(console.error);
