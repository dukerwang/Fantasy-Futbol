import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPlayerBack } from '@/lib/players/cardData';

/**
 * GET /api/players/[playerId]/log?leagueId=&season=
 *
 * Back of the premium player card: game log and career history. Needs FPL's
 * element-summary/bootstrap/fixtures endpoints, so it is the slow half — the
 * card fetches it in the background after paint, never as a gate.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const { searchParams } = new URL(req.url);
  const admin = createAdminClient();

  const back = await fetchPlayerBack(
    admin,
    playerId,
    searchParams.get('leagueId'),
    searchParams.get('season'),
  );

  // No stale-while-revalidate: it kept serving a pre-backfill payload for ten
  // minutes after the data behind it changed, which reads as "the fix didn't
  // work". Revalidate every time; the request is cheap and correctness of a
  // visible opponent column matters more than shaving a round trip.
  return NextResponse.json(back, {
    headers: { 'Cache-Control': 'private, no-cache' },
  });
}
