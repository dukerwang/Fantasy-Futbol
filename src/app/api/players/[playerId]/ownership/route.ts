import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPlayerOwnership } from '@/lib/players/cardData';

/**
 * GET /api/players/[playerId]/ownership?leagueId=
 *
 * Standalone owner-crest lookup. The card itself gets ownership from its props
 * or from `/card`; this stays for callers that need only the crest.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const leagueId = new URL(req.url).searchParams.get('leagueId');
  if (!leagueId) return NextResponse.json({ ownership: null });

  const ownership = await fetchPlayerOwnership(createAdminClient(), playerId, leagueId);
  return NextResponse.json({ ownership });
}
