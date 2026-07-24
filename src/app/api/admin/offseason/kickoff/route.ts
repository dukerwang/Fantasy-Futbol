import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { previewSeasonKickoff, runSeasonKickoff } from '@/lib/offseason/seasonKickoff';

export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  return !!secret && !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

/** GET: preview summer auctions and pending relegation drops before kickoff, for one league */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('league_id');
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id required' }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const preview = await previewSeasonKickoff(admin, leagueId);
    return NextResponse.json({
      leagueId,
      leagueStatus: preview.leagueStatus,
      rosterLocked: preview.rosterLocked,
      preview: {
        relegationPlayers: preview.relegationPlayers,
        totalRelegationFaab: preview.totalRelegationFaab,
        summerArrivals: preview.summerArrivals,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

/** POST: execute season kickoff for one league (process relegations + seed summer auctions + activate) */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { league_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { league_id: leagueId } = body;
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id required in request body' }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const result = await runSeasonKickoff(admin, leagueId);
    return NextResponse.json({
      ok: true,
      message: 'Season started successfully.',
      relegationResults: result.relegationResults,
      auctionsCreated: result.auctionsCreated,
      auctionedPlayers: result.auctionedPlayers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[kickoff] Failed:', message);
    const status = message.includes('not found') ? 404 : message.includes('not in offseason') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
