import { NextRequest, NextResponse } from 'next/server';
import { authorizeFutbolpediaRead } from '@/lib/auth/authorizeFutbolpediaRead';
import { buildFutbolpediaClubContext } from '@/lib/integrations/futbolpediaContext';

/**
 * Read-only club context for Futbolpedia Gaffa mode.
 * Auth: x-futbolpedia-secret === FUTBOLPEDIA_READ_SECRET
 */
export async function GET(req: NextRequest) {
  if (!authorizeFutbolpediaRead(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim();
  const teamId = req.nextUrl.searchParams.get('teamId')?.trim();
  if (!leagueId || !teamId) {
    return NextResponse.json({ error: 'Missing leagueId or teamId' }, { status: 400 });
  }

  try {
    const bag = await buildFutbolpediaClubContext(leagueId, teamId);
    if (!bag) {
      return NextResponse.json({ error: 'League or club not found' }, { status: 404 });
    }
    return NextResponse.json(bag);
  } catch (err) {
    console.error('[futbolpedia/context]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to build club context' }, { status: 500 });
  }
}
