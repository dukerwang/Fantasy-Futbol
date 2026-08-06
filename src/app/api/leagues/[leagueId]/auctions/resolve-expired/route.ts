/**
 * POST /api/leagues/[leagueId]/auctions/resolve-expired
 *
 * Resolves a single auction the instant its clock runs out, instead of
 * waiting for the `process-auctions` pg_cron sweep (up to a few minutes away
 * — see 019_auction_pgcron.sql). Called by `useLiveTransfers` client-side the
 * moment any connected viewer's clock crosses an auction's `expires_at`; the
 * resulting `auction_state` UPDATE is then realtime-pushed to everyone in the
 * league, so only one viewer needs to trigger this for all of them to see it.
 *
 * `resolve_single_player_auction_rpc` (052) does NOT itself check whether the
 * auction has actually expired — the Buy Now caller in ../bid/route.ts gets
 * away with that because it always resolves an auction it just forced to
 * expire. This route is reachable by any league member for any player, so it
 * re-checks `expires_at` server-side before calling the RPC; skipping that
 * check would let a leading bidder end their own auction early to dodge being
 * outbid.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLockedPlTeamIds } from '@/lib/auction/lockedClubs';
import { notifyAuctionResolution, type AuctionResolutionResult } from '@/lib/auctions/notifyAuctionResolution';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { playerId } = body as { playerId: string };
  if (!playerId) return NextResponse.json({ error: 'playerId is required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();
  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // The load-bearing check: only resolve auctions that have actually expired.
  const { data: auction } = await admin
    .from('auction_state')
    .select('expires_at, status')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle();

  // Already resolved (a concurrent viewer beat us to it, or the sweep already
  // ran) or never existed — no-op rather than an error, since multiple viewers
  // racing to call this the same second is the expected case.
  if (!auction || auction.status !== 'live') {
    return NextResponse.json({ ok: true, resolved: false, reason: 'not_live' });
  }
  if (!auction.expires_at || new Date(auction.expires_at).getTime() > Date.now()) {
    return NextResponse.json({ error: 'Auction has not expired yet' }, { status: 400 });
  }

  const { data: wonPlayer } = await admin
    .from('players')
    .select('name, market_value')
    .eq('id', playerId)
    .single();

  const { count: bidderCount } = await admin
    .from('waiver_claims')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .not('team_id', 'is', null);

  const { lockedPlTeamIds } = await getLockedPlTeamIds();
  const { data: rpcRes, error: rpcError } = await admin.rpc('resolve_single_player_auction_rpc', {
    p_league_id: leagueId,
    p_player_id: playerId,
    p_locked_pl_team_ids: lockedPlTeamIds,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as AuctionResolutionResult;
  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to resolve auction' }, { status: 400 });
  }

  if (!resData.deferred) {
    await notifyAuctionResolution(admin, {
      leagueId,
      playerId,
      playerName: wonPlayer?.name ?? 'Unknown Player',
      playerMarketValue: wonPlayer?.market_value,
      bidderCount: bidderCount ?? 0,
      resData,
    });
  }

  return NextResponse.json({ ok: true, resolved: !resData.deferred });
}
