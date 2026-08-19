/**
 * POST /api/leagues/[leagueId]/listings/[listingId]/bid  — DEPRECATED
 *
 * Superseded by POST /api/leagues/[leagueId]/auctions/bid, which is now the
 * single bid path for both free agents and listings. This handler survives only
 * because the pre-hub Player Sales tab still calls it; it is deleted along with
 * that UI.
 *
 * It no longer contains any bidding logic of its own. The previous version ran
 * five unlocked statements — insert anchor, flip the listing to 'active', cancel
 * trade proposals, upsert the bid, extend expiry — with no transaction around
 * them, so an offer accepted between statements two and three could sell the
 * player twice. All of that now happens inside place_auction_bid_rpc (079).
 *
 * Migration 080 also broke this route outright: it branched on "no anchor claim
 * exists yet" to decide whether a bid was the FIRST bid, and 080 seeds that
 * anchor when the listing is created. The condition stopped ever being true, so
 * bids silently skipped the player lock, the status flip to 'active', and the
 * cancellation of pending offers. Delegating removes the branch entirely — the
 * RPC decides what counts as a first bid by looking at actual bids.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateExpiresAt } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
import { getLockedPlTeamIds } from '@/lib/auction/lockedClubs';

interface Props {
  params: Promise<{ leagueId: string; listingId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, listingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bidAmount, dropPlayerId } = (await req.json()) as {
    bidAmount: number;
    dropPlayerId?: string | null;
  };

  if (!Number.isInteger(bidAmount) || bidAmount < 0) {
    return NextResponse.json({ error: 'bidAmount must be a non-negative integer' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();
  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  const { data: listing } = await admin
    .from('player_sale_listings')
    .select('id, player_id, status')
    .eq('id', listingId)
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  if (listing.status !== 'pending' && listing.status !== 'active') {
    return NextResponse.json(
      { error: `Bidding is closed for this listing (status is ${listing.status})` },
      { status: 400 },
    );
  }

  if (bidAmount > myTeam.faab_budget) {
    return NextResponse.json({ error: 'Insufficient Club Balance' }, { status: 400 });
  }

  const { data: league } = await admin
    .from('leagues')
    .select('roster_locked')
    .eq('id', leagueId)
    .single();
  if (league?.roster_locked) {
    return NextResponse.json({ error: 'Rosters are locked. Auction bids are not allowed.' }, { status: 403 });
  }

  const { data: playerData } = await admin
    .from('players')
    .select('name, market_value')
    .eq('id', listing.player_id)
    .single();

  // The activity timer is computed here and handed to the RPC, matching
  // /auctions/bid. first_bid_at lives on the anchor row.
  const { data: anchor } = await admin
    .from('waiver_claims')
    .select('first_bid_at')
    .eq('league_id', leagueId)
    .eq('player_id', listing.player_id)
    .eq('sale_listing_id', listingId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .is('team_id', null)
    .maybeSingle();

  const now = Date.now();
  // Sale listings share the timer with free agents, so the decaying timeout and
  // the quiet-hours guard apply to them too. That is intended.
  const { quietHours } = await getLeagueAuctionSettings(admin, leagueId);
  const firstBidTime = anchor?.first_bid_at ? new Date(anchor.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, quietHours);

  const { data: rpcRes, error: rpcError } = await admin.rpc('place_auction_bid_rpc', {
    p_league_id: leagueId,
    p_team_id: myTeam.id,
    p_player_id: listing.player_id,
    p_drop_player_id: dropPlayerId || null,
    p_bid_amount: bidAmount,
    p_expires_at: new Date(expiresAt).toISOString(),
    p_now: new Date(now).toISOString(),
    p_expect_sale_listing_id: listingId,
  });

  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });

  const res = rpcRes as {
    success: boolean;
    error?: string;
    is_buy_now?: boolean;
    expires_at?: string;
    outbid_team_id?: string;
    outbid_team_user_id?: string;
    outbid_user_email?: string;
    is_first_bid?: boolean;
  };

  if (!res.success) {
    return NextResponse.json({ error: res.error || 'Failed to place bid' }, { status: 400 });
  }

  // Buy Now resolves inline — see the note in /auctions/bid. A failure here is
  // not fatal: the bid committed, and the pg_cron sweep is a correct fallback.
  let resolved = false;
  if (res.is_buy_now) {
    try {
      const { lockedPlTeamIds } = await getLockedPlTeamIds();
      const { error: resolveErr } = await admin.rpc('resolve_single_player_auction_rpc', {
        p_league_id: leagueId,
        p_player_id: listing.player_id,
        p_locked_pl_team_ids: lockedPlTeamIds,
      });
      if (resolveErr) console.error('[listing-bid] Buy Now resolution failed:', resolveErr);
      else resolved = true;
    } catch (err) {
      console.error('[listing-bid] Buy Now resolution threw:', err);
    }
  }

  if (!res.is_buy_now && res.outbid_team_id && res.outbid_team_user_id) {
    try {
      // In-app + push only — see the matching note in /auctions/bid.
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: res.outbid_team_user_id,
        title: 'Outbid!',
        content: `You have been outbid on the market for **${playerData?.name ?? 'a player'}**. The new high bid is now **€${bidAmount}m**.`,
        url: `/league/${leagueId}/transfers/listings`,
        tag: `outbid-listing-${listingId}`,
      });
    } catch (err) {
      console.error('[listing-bid] Failed to send outbid notification:', err);
    }
  }

  // See the matching block in /auctions/bid — same "opening bid only" gate,
  // in-app + push only, no email.
  if (!res.is_buy_now && res.is_first_bid) {
    try {
      const { data: otherTeams } = await admin
        .from('teams')
        .select('user_id')
        .eq('league_id', leagueId)
        .neq('id', myTeam.id);

      if (otherTeams && otherTeams.length > 0) {
        const { createNotification } = await import('@/lib/notifications/createNotification');
        await Promise.all(
          otherTeams.map((t) =>
            createNotification(admin, {
              leagueId,
              userId: t.user_id,
              title: 'Bidding Open',
              content: `**${playerData?.name ?? 'A player'}** just received its first bid — **€${bidAmount}m**. Bidding is now open.`,
              url: `/league/${leagueId}/transfers/listings`,
              tag: `first-bid-auction-${listingId}`,
            })
          )
        );
      }
    } catch (err) {
      console.error('[listing-bid] Failed to send new-bid notifications:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    expires_at: res.expires_at ?? new Date(expiresAt).toISOString(),
    is_buy_now: !!res.is_buy_now,
    resolved,
  });
}
