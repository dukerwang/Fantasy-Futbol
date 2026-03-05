import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/players/[playerId]
 *
 * Returns the game-by-game log for a player — their last 10 entries from
 * player_stats, ordered most-recent-first.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('player_stats')
    .select('gameweek, fantasy_points, match_rating, stats')
    .eq('player_id', playerId)
    .order('gameweek', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ gamelog: data ?? [] });
}
