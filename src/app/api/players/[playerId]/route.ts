import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPlayerBack, fetchPlayerFront } from '@/lib/players/cardData';

/**
 * GET /api/players/[playerId]?leagueId=&season=
 *
 * Combined front + back payload, kept for callers that want a player and its
 * game log in one request.
 *
 * The player card does NOT use this — it would make the front face wait on the
 * FPL round trips the back face needs. Cards read `/card` and `/log` separately
 * so the fast half can paint immediately.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('leagueId');
  const season = searchParams.get('season');
  const admin = createAdminClient();

  const [front, back] = await Promise.all([
    fetchPlayerFront(admin, playerId, leagueId, season),
    fetchPlayerBack(admin, playerId, leagueId, season),
  ]);

  if (!front) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  return NextResponse.json({
    player: front.player,
    ownership: front.ownership,
    gamelog: back.gamelog,
    history: back.history,
  });
}
