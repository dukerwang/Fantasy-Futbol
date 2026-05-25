import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating } from '../src/lib/scoring/engine.ts';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';

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

  const raya = players[0];
  const { data: stats } = await supabase
    .from('player_stats')
    .select('gameweek, stats, match_rating_v2, fantasy_points_v2')
    .eq('player_id', raya.id)
    .eq('gameweek', 2);

  const rawStats = stats[0].stats;
  const refStats = await loadReferenceStats(supabase, '2025-26');

  console.log("Raw stats from DB:", rawStats);
  console.log("Stored rating in DB (V2):", stats[0].match_rating_v2);
  console.log("Stored points in DB (V2):", stats[0].fantasy_points_v2);

  const ratingObj = calculateMatchRating(rawStats, 'GK', refStats);
  console.log("Recalculated rating object using matchRating.ts:", JSON.stringify(ratingObj, null, 2));
}

main().catch(console.error);
