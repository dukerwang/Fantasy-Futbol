import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getOutbidEmail } from '@/lib/email/templates';
import {
  BIG_TRANSFER_THRESHOLD,
  calculateExpiresAt,
} from '@/lib/auction/timer';

interface Props {
  params: Promise<{ leagueId: string; listingId: string }>;
}

function calculateAgeInYears(dobIso: string, referenceDate = new Date()): number {
  const dob = new Date(dobIso);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, listingId } = await params;

  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { bidAmount, dropPlayerId } = body as {
    bidAmount: number;
    dropPlayerId?: string | null;
  };

  if (bidAmount === undefined || bidAmount === null) {
    return NextResponse.json({ error: 'bidAmount is required' }, { status: 400 });
  }
  if (!Number.isInteger(bidAmount) || bidAmount < 0) {
    return NextResponse.json({ error: 'bidAmount must be a non-negative integer' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 2. Caller must have a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // 3. Fetch listing and lock it
  const { data: listing } = await admin
    .from('player_sale_listings')
    .select('*')
    .eq('id', listingId)
    .eq('league_id', leagueId)
    .single();

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  if (listing.status !== 'pending' && listing.status !== 'active') {
    return NextResponse.json(
      { error: `Bidding is closed for this listing (status is ${listing.status})` },
      { status: 400 }
    );
  }

  // Seller cannot bid on their own listing
  if (listing.seller_team_id === myTeam.id) {
    return NextResponse.json({ error: 'Sellers cannot bid on their own listings' }, { status: 403 });
  }

  // Check FAAB
  if (bidAmount > myTeam.faab_budget) {
    return NextResponse.json({ error: 'Insufficient Club Balance' }, { status: 400 });
  }

  // Minimum bid validation (seller-set floor)
  if (bidAmount < listing.min_bid) {
    return NextResponse.json(
      { error: `Bid must be at least the minimum bid of €${listing.min_bid}m` },
      { status: 400 }
    );
  }

  // 4. Fetch league settings
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, taxi_size, taxi_age_limit, roster_locked')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  if (league.roster_locked) {
    return NextResponse.json(
      { error: 'Rosters are locked. Auction bids are not allowed.' },
      { status: 403 }
    );
  }

  // 5. Fetch player details
  const { data: playerData } = await admin
    .from('players')
    .select('market_value, name, date_of_birth')
    .eq('id', listing.player_id)
    .single();

  if (!playerData) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  // 6. IR check
  const { data: illegalIr } = await admin
    .from('roster_entries')
    .select('id, player:players(fpl_status)')
    .eq('team_id', myTeam.id)
    .eq('status', 'ir');

  if (illegalIr?.some(e => (e.player as unknown as { fpl_status: string } | null)?.fpl_status === 'a')) {
    return NextResponse.json({ error: 'Cannot place a bid while you have a healthy player occupying an IR slot. Please activate them first.' }, { status: 400 });
  }

  // 7. Academy compliance check (grandfather rule)
  const ageLimit = league.taxi_age_limit ?? 21;
  const { data: academyRows } = await admin
    .from('roster_entries')
    .select('player:players(name, date_of_birth)')
    .eq('team_id', myTeam.id)
    .eq('status', 'taxi');

  const agedOut = (academyRows ?? []).find((r) => {
    const player = r.player as unknown as { name: string; date_of_birth: string | null } | null;
    const dob = player?.date_of_birth;
    if (!dob) return false;
    return calculateAgeInYears(dob) > ageLimit;
  });

  if (agedOut) {
    const agedOutName = (agedOut.player as unknown as { name: string } | null)?.name ?? 'A player';
    return NextResponse.json(
      { error: `Academy compliance required: ${agedOutName} has aged out. Promote or drop aged-out academy players before placing new bids.` },
      { status: 400 }
    );
  }

  // 8. Roster capacity check
  const { count: activeRosterCount } = await admin
    .from('roster_entries')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', myTeam.id)
    .not('status', 'in', '("ir","taxi")');

  const rosterFull = (activeRosterCount ?? 0) >= (league.roster_size ?? 20);

  if (rosterFull && !dropPlayerId) {
    const { count: academyCount } = await admin
      .from('roster_entries')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', myTeam.id)
      .eq('status', 'taxi');

    const academyMax = league.taxi_size ?? 3;
    if ((academyCount ?? 0) >= academyMax) {
      return NextResponse.json(
        { error: `Roster is full and academy is full (${academyMax} slots). Select a player to drop.` },
        { status: 400 }
      );
    }

    if (!playerData.date_of_birth) {
      return NextResponse.json(
        { error: 'Roster is full. This player has no DOB on record, so they cannot be auto-routed into academy; select a drop player.' },
        { status: 400 }
      );
    }

    const age = calculateAgeInYears(playerData.date_of_birth);
    if (age > ageLimit) {
      return NextResponse.json(
        { error: `Roster is full. ${playerData.name} is age ${age} and not U${ageLimit} academy-eligible; select a drop player instead.` },
        { status: 400 }
      );
    }
  }

  // 9. Drop conflicts check
  if (dropPlayerId) {
    const { data: conflictingBids } = await admin
      .from('waiver_claims')
      .select('id')
      .eq('league_id', leagueId)
      .eq('team_id', myTeam.id)
      .eq('drop_player_id', dropPlayerId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .neq('player_id', listing.player_id);

    if (conflictingBids && conflictingBids.length > 0) {
      return NextResponse.json(
        { error: 'This player is already nominated as a drop in another of your pending bids. Each pending bid must nominate a different player to drop.' },
        { status: 400 }
      );
    }
  }

  // 10. Fetch current anchor system claim for the listing (if it exists)
  const { data: anchorClaim } = await admin
    .from('waiver_claims')
    .select('*')
    .eq('league_id', leagueId)
    .eq('player_id', listing.player_id)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .eq('sale_listing_id', listingId)
    .is('team_id', null)
    .maybeSingle();

  // If active, check if there's a higher bid
  let highestBid = 0;
  if (listing.status === 'active') {
    const { data: highestActiveClaim } = await admin
      .from('waiver_claims')
      .select('faab_bid')
      .eq('league_id', leagueId)
      .eq('player_id', listing.player_id)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .eq('sale_listing_id', listingId)
      .not('team_id', 'is', null)
      .order('faab_bid', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (highestActiveClaim) {
      highestBid = highestActiveClaim.faab_bid;
    }
  }

  if (listing.status === 'active' && bidAmount <= highestBid) {
    return NextResponse.json(
      { error: `Your bid of €${bidAmount}m must beat the current highest bid of €${highestBid}m.` },
      { status: 400 }
    );
  }

  // 11. Timer Calculation (Activity-Based)
  const now = Date.now();
  const isBigTransfer = Number(playerData.market_value || 0) >= BIG_TRANSFER_THRESHOLD;
  const firstBidTime = anchorClaim?.first_bid_at ? new Date(anchorClaim.first_bid_at).getTime() : now;
  
  let expiresAt: string;
  let isBuyNow = false;

  if (listing.buy_now_price !== null && bidAmount >= listing.buy_now_price) {
    // Buy Now triggered: expire immediately
    expiresAt = new Date(now - 1000).toISOString();
    isBuyNow = true;
  } else {
    expiresAt = calculateExpiresAt(firstBidTime, now, isBigTransfer);
  }

  // 12. Transactional inserts / updates
  // A. Create or update the anchor claim
  if (!anchorClaim) {
    // First bid: insert anchor claim
    await admin.from('waiver_claims').insert({
      league_id: leagueId,
      team_id: null,
      player_id: listing.player_id,
      faab_bid: 0,
      priority: 999,
      status: 'pending',
      gameweek: 0,
      is_auction: true,
      sale_listing_id: listingId,
      first_bid_at: new Date(now).toISOString(),
      last_bid_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    });

    // Mark listing as active, lock player, cancel trade proposals
    await admin
      .from('player_sale_listings')
      .update({
        status: 'active',
        auction_expires_at: expiresAt,
        updated_at: new Date(now).toISOString(),
      })
      .eq('id', listingId);

    // Cancel trade proposals involving this player
    const { cancelTradeProposalsForLockedPlayer } = await import('@/lib/listings/cancelTradeProposals');
    await cancelTradeProposalsForLockedPlayer(admin, leagueId, listing.player_id);

  } else {
    // Subsequent bid: update anchor claim expires_at & last_bid_at
    await admin
      .from('waiver_claims')
      .update({
        last_bid_at: new Date(now).toISOString(),
        expires_at: expiresAt,
      })
      .eq('id', anchorClaim.id);

    // Update listing's auction_expires_at
    await admin
      .from('player_sale_listings')
      .update({
        auction_expires_at: expiresAt,
        updated_at: new Date(now).toISOString(),
      })
      .eq('id', listingId);
  }

  // B. Upsert bidder's own claim
  const { data: myClaim } = await admin
    .from('waiver_claims')
    .select('id')
    .eq('league_id', leagueId)
    .eq('team_id', myTeam.id)
    .eq('player_id', listing.player_id)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .eq('sale_listing_id', listingId)
    .maybeSingle();

  if (myClaim) {
    await admin
      .from('waiver_claims')
      .update({
        faab_bid: bidAmount,
        drop_player_id: dropPlayerId || null,
        expires_at: expiresAt,
      })
      .eq('id', myClaim.id);
  } else {
    await admin.from('waiver_claims').insert({
      league_id: leagueId,
      team_id: myTeam.id,
      player_id: listing.player_id,
      drop_player_id: dropPlayerId || null,
      faab_bid: bidAmount,
      priority: 999,
      status: 'pending',
      gameweek: 0,
      is_auction: true,
      sale_listing_id: listingId,
      expires_at: expiresAt,
    });
  }

  // If Buy Now, update all pending claims to the same immediate expires_at so cron executes them
  if (isBuyNow) {
    await admin
      .from('waiver_claims')
      .update({ expires_at: expiresAt })
      .eq('league_id', leagueId)
      .eq('player_id', listing.player_id)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .eq('sale_listing_id', listingId);
  }

  // 13. Send Outbid Notification
  if (listing.status === 'active' && highestBid > 0 && !isBuyNow) {
    try {
      const { data: prevHighestClaim } = await admin
        .from('waiver_claims')
        .select('team:teams(id, user_id)')
        .eq('league_id', leagueId)
        .eq('player_id', listing.player_id)
        .eq('status', 'pending')
        .eq('is_auction', true)
        .eq('sale_listing_id', listingId)
        .not('team_id', 'is', null)
        .order('faab_bid', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevTeam = prevHighestClaim?.team as unknown as { id: string; user_id: string } | null;

      if (prevTeam && prevTeam.id !== myTeam.id) {
        const { data: prevUser } = await admin
          .from('users')
          .select('email')
          .eq('id', prevTeam.user_id)
          .single();

        if (prevUser?.email) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
          await sendEmail({
            to: [prevUser.email],
            subject: `Outbid! ${playerData.name} market update`,
            html: getOutbidEmail(
              playerData.name,
              bidAmount,
              `${baseUrl}/league/${leagueId}`
            )
          });
        }

        const { createNotification } = await import('@/lib/notifications/createNotification');
        await createNotification(admin, {
          leagueId,
          userId: prevTeam.user_id,
          title: 'Outbid Warning!',
          content: `You have been outbid on the market for **${playerData.name}**. The new high bid is now **€${bidAmount}m**.`,
          url: `/league/${leagueId}/trades`
        });
      }
    } catch (err) {
      console.error('[listing-bid] Failed to send outbid notification:', err);
    }
  }

  return NextResponse.json({ ok: true, expires_at: expiresAt, is_buy_now: isBuyNow });
}
