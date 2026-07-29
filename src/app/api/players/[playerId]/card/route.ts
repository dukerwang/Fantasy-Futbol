import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPlayerFront } from '@/lib/players/cardData';

/**
 * GET /api/players/[playerId]/card?leagueId=&season=
 *
 * Front of the premium player card: identity, season-resolved points/ppg/form,
 * ranks, and the owner crest. Pure Supabase — deliberately never touches the
 * FPL API, so this stays fast enough to open a card on.
 *
 * List pages normally pass this data down as props and never call it; it
 * exists for the call sites that only hold a player id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const { searchParams } = new URL(req.url);
  const admin = createAdminClient();

  const front = await fetchPlayerFront(
    admin,
    playerId,
    searchParams.get('leagueId'),
    searchParams.get('season'),
  );

  if (!front) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

  return NextResponse.json(front, {
    headers: { 'Cache-Control': 'private, no-cache' },
  });
}
