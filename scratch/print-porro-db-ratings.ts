import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function checkDbStats() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: player } = await supabase
    .from('players')
    .select('id')
    .ilike('name', '%Pedro Porro%')
    .maybeSingle();

  if (!player) return;

  const { data: statsList, error } = await supabase
    .from('player_stats')
    .select('gameweek, match_rating, match_rating_v2, fantasy_points, fantasy_points_v2, stats')
    .eq('player_id', player.id)
    .order('gameweek', { ascending: true });

  if (error || !statsList) {
    console.error(error);
    return;
  }

  console.log(`Pedro Porro's DB entries in player_stats:`);
  console.log(`GW | rating_v1 | rating_v2 | points_v1 | points_v2 | mins`);
  console.log(`---|-----------|-----------|-----------|-----------|-----`);

  let playedCount = 0;
  let sumRatingV2 = 0;
  let sumPointsV2 = 0;

  for (const s of statsList) {
    const raw = s.stats as any;
    const mins = raw.minutes_played ?? 0;
    console.log(
      `${String(s.gameweek).padStart(2)} | ` +
      `${String(s.match_rating).padStart(9)} | ` +
      `${String(s.match_rating_v2).padStart(9)} | ` +
      `${String(s.fantasy_points).padStart(9)} | ` +
      `${String(s.fantasy_points_v2).padStart(9)} | ` +
      `${String(mins).padStart(3)}`
    );
    if (mins > 0) {
      playedCount++;
      sumRatingV2 += Number(s.match_rating_v2 ?? 0);
      sumPointsV2 += Number(s.fantasy_points_v2 ?? 0);
    }
  }

  console.log(`\nPlayed Games: ${playedCount}`);
  console.log(`Average match_rating_v2: ${(sumRatingV2 / playedCount).toFixed(2)}`);
  console.log(`Average fantasy_points_v2: ${(sumPointsV2 / playedCount).toFixed(2)}`);
}

checkDbStats().catch(console.error);
