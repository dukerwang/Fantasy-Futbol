import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';

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

async function checkRatings() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Get Pedro Porro's player ID
  const { data: player } = await supabase
    .from('players')
    .select('id, name')
    .ilike('name', '%Pedro Porro%')
    .maybeSingle();

  if (!player) {
    console.error('Pedro Porro not found');
    return;
  }

  // 2. Fetch all his player stats where he played
  const { data: statsList, error } = await supabase
    .from('player_stats')
    .select('gameweek, match_rating, match_rating_v2, stats')
    .eq('player_id', player.id);

  if (error || !statsList) {
    console.error('Error fetching stats:', error);
    return;
  }

  console.log(`Loaded ${statsList.length} game stats for ${player.name}.\n`);

  let sumRB = 0;
  let sumRWB = 0;
  let playedGames = 0;

  for (const s of statsList) {
    const rawStats = s.stats as any;
    const minutes = rawStats.minutes_played ?? 0;
    if (minutes <= 0) continue; // Only count games played

    playedGames++;

    // Calculate rating as RB
    const rbRating = calculateMatchRating(rawStats, 'RB', DEFAULT_REFERENCE_STATS);
    // Calculate rating as RWB
    const rwbRating = calculateMatchRating(rawStats, 'RWB', DEFAULT_REFERENCE_STATS);

    sumRB += rbRating.rating;
    sumRWB += rwbRating.rating;
  }

  const ppgRB = sumRB / playedGames;
  const ppgRWB = sumRWB / playedGames;

  console.log(`Played Games: ${playedGames}`);
  console.log(`PPG as RB:   ${ppgRB.toFixed(2)}`);
  console.log(`PPG as RWB:  ${ppgRWB.toFixed(2)}`);
}

checkRatings().catch(console.error);
