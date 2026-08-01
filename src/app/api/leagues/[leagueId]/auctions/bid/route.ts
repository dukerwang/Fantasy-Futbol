import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getOutbidEmail } from '@/lib/email/templates';
import {
  calculateExpiresAt,
} from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';
import { getLockedPlTeamIds } from '@/lib/auction/lockedClubs';

interface Props {
  params: Promise<{ leagueId: string }>;
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
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { playerId, bidAmount, dropPlayerId, saleListingId } = body as {
    playerId: string;
    bidAmount: number;
    dropPlayerId?: string | null;
    /**
     * Optional. The listing the CLIENT believes it is bidding on. The RPC
     * resolves the listing itself and only uses this to fail loudly when the two
     * disagree — e.g. the listing sold a second ago and a new one was created
     * for the same player. Never trusted as the source of truth.
     */
    saleListingId?: string | null;
  };

  if (!playerId || bidAmount === undefined || bidAmount === null) {
    return NextResponse.json({ error: 'playerId and bidAmount are required' }, { status: 400 });
  }
  if (!Number.isInteger(bidAmount) || bidAmount < 0) {
    return NextResponse.json({ error: 'bidAmount must be a non-negative integer' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Caller must have a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  const auctionSettings = await getLeagueAuctionSettings(admin, leagueId);

  // Validate FAAB (simple check against current balance; cron will re-validate at resolution)
  if (bidAmount > myTeam.faab_budget) {
    return NextResponse.json({ error: 'Insufficient Club Balance' }, { status: 400 });
  }

  // Enforce IR legality
  const { data: illegalIr } = await admin
    .from('roster_entries')
    .select('id, player:players(fpl_status)')
    .eq('team_id', myTeam.id)
    .eq('status', 'ir');

  if (illegalIr?.some(e => (e.player as unknown as { fpl_status: string } | null)?.fpl_status === 'a')) {
    return NextResponse.json({ error: 'Cannot place a bid while you have a healthy player occupying an IR slot. Please activate them first.' }, { status: 400 });
  }

  // League settings for roster/academy validations
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, taxi_size, taxi_age_limit, roster_locked, previous_season, current_season')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  // Buy-back exclusion. A manager who took compensation for this player and
  // then sees him return to the PL would otherwise arrive at the auction with a
  // budget inflated by exactly that player's value — a free option nobody else
  // in the league has, and their downside is bounded at "back where I started".
  // Having chosen the cash over his rights, they sit this one out.
  //
  // Keyed on original_team_id, not team_id, so trading rights away cannot
  // launder the restriction. Lapses with the season cycle: a release from two
  // summers ago is ancient history, not a permanent ban.
  const seasonScope = [league.current_season, league.previous_season].filter(Boolean);
  if (seasonScope.length > 0) {
    const { data: released } = await admin
      .from('departure_decisions')
      .select('id')
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .eq('original_team_id', myTeam.id)
      .eq('status', 'released')
      .in('season_from', seasonScope)
      // limit before maybeSingle: a player released in both the previous and
      // current season yields two rows, and maybeSingle() throws on more than
      // one — which would have failed the bid with a database error instead of
      // the intended refusal.
      .limit(1)
      .maybeSingle();

    if (released) {
      return NextResponse.json(
        {
          error:
            'You took compensation when this player left the Premier League, so you cannot bid on his return this season. You had the option to retain his rights instead.',
        },
        { status: 403 },
      );
    }
  }

  if (league.roster_locked) {
    return NextResponse.json(
      { error: 'Rosters are locked during the offseason. Auction bids are not allowed until the new season begins.' },
      { status: 403 },
    );
  }

  // until they are promoted/dropped (unless the manager is fixing it manually).
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
      { status: 400 },
    );
  }

  // Transfermarkt minimum bid: 20% of the player's current market value
  const { data: playerData } = await admin
    .from('players')
    .select('market_value, name, date_of_birth, pl_team')
    .eq('id', playerId)
    .single();

  // Quarantine: a null market_value isn't "worth nothing", it's "not priced
  // yet" -- syncPlayers.ts inserts new signings with market_value: null (see
  // its comment) precisely because FPL's own price is a different, unusable
  // scale, and treating null as 0 here would let a brand-new arrival be
  // claimed for the table minimum before Transfermarkt has ever valued them.
  // Lifts automatically once a real value lands (daily gap-sync or the
  // monthly full refresh -- see .github/workflows/sync-transfermarkt*.yml).
  if (playerData && playerData.market_value == null) {
    return NextResponse.json(
      {
        error: `${playerData.name ?? 'This player'} hasn't been priced by Transfermarkt yet and can't be bid on. Check back once a value is synced.`,
      },
      { status: 400 },
    );
  }

  // Is this a manager's listing or an open free agent? The RPC resolves this
  // authoritatively under FOR UPDATE; this read only decides which price floor
  // to pre-check so the caller gets a specific message instead of a generic one.
  const { data: openListing } = await admin
    .from('player_sale_listings')
    .select('id, min_bid, seller_team_id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  if (openListing) {
    // The seller's own floor governs, and 077 already guarantees it is at least
    // 80% of market value. Applying the free-agent 20% rule on top would be
    // both redundant and, for a cheap player under an ambitious ask, wrong.
    if (bidAmount < openListing.min_bid) {
      return NextResponse.json(
        { error: `Bid must be at least the seller's minimum of €${openListing.min_bid}m.` },
        { status: 400 },
      );
    }
  } else {
    // Free agent: a floor as a share of market value, per league setting
    // (default 50% — migration 095).
    //
    // This was a hardcoded 20% while a MANAGER's listing has been floored at
    // 80% by a DB trigger since 077_listing_gates.sql. Same player, four times
    // the price depending on who was selling. The consequences were that a full
    // window's shopping cost only 22% of a starting balance, and that manager
    // listings were nearly unsellable — nobody pays 80% to a rival when the
    // equivalent free agent costs 20%.
    const floorPct = auctionSettings.bidFloor;
    const minimumBid = playerData
      ? Math.floor(Number(playerData.market_value || 0) * floorPct)
      : 0;
    if (minimumBid > 0 && bidAmount < minimumBid) {
      return NextResponse.json(
        {
          error: `Minimum bid for this player is €${minimumBid}m (${Math.round(floorPct * 100)}% of market value)`,
        },
        { status: 400 },
      );
    }
  }

  // Roster capacity check.
  // If the active roster is full and no drop is nominated, we treat the bid as
  // "win directly into academy" and validate academy age + slot constraints.
  const { count: activeRosterCount } = await admin
    .from('roster_entries')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', myTeam.id)
    .not('status', 'in', '("ir","taxi","loan_in")');

  // Count active buybacks for this team
  const { count: buybackCount } = await admin
    .from('player_loans')
    .select('id', { count: 'exact', head: true })
    .eq('lender_team_id', myTeam.id)
    .eq('status', 'active')
    .eq('slot_buyback_used', true);

  const effectiveRosterLimit = (league.roster_size ?? 20) + (buybackCount ?? 0);
  const rosterFull = (activeRosterCount ?? 0) >= effectiveRosterLimit;

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
        { status: 400 },
      );
    }

    if (!playerData?.date_of_birth) {
      return NextResponse.json(
        { error: 'Roster is full. This player has no DOB on record, so they cannot be auto-routed into academy; select a drop player.' },
        { status: 400 },
      );
    }

    const age = calculateAgeInYears(playerData.date_of_birth);
    if (age > ageLimit) {
      return NextResponse.json(
        { error: `Roster is full. ${playerData.name} is age ${age} and not U${ageLimit} academy-eligible; select a drop player instead.` },
        { status: 400 },
      );
    }
  }

  // Guard: the same drop player cannot be nominated in two simultaneous pending bids.
  // If both auctions resolve the winner would lose the drop player on the first
  // and then try (and silently succeed) to drop them again on the second — gaining
  // two players while only losing one.
  if (dropPlayerId) {
    const { data: conflictingBids } = await admin
      .from('waiver_claims')
      .select('id')
      .eq('league_id', leagueId)
      .eq('team_id', myTeam.id)
      .eq('drop_player_id', dropPlayerId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .neq('player_id', playerId); // exclude the current player's own auction

    if (conflictingBids && conflictingBids.length > 0) {
      return NextResponse.json(
        { error: 'This player is already nominated as a drop in another of your pending bids. Each pending bid must nominate a different player to drop.' },
        { status: 400 },
      );
    }
  }

  // Fetch system seed claim to check expiry, first bid time, and staggered-release gate
  const { data: systemSeedClaim } = await admin
    .from('waiver_claims')
    .select('expires_at, first_bid_at, opens_at')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .is('team_id', null)
    .maybeSingle();

  if (systemSeedClaim?.expires_at && new Date().getTime() >= new Date(systemSeedClaim.expires_at).getTime()) {
    return NextResponse.json(
      { error: 'This auction has already expired and is awaiting processing.' },
      { status: 400 },
    );
  }

  // Staggered release: season kickoff seeds the elite tier with future opens_at
  // values so managers compete for the same players instead of picking from
  // 14-25 simultaneous auctions. Every other seeding path writes NULL.
  //
  // This is the ONLY enforcement point. The auction list deliberately still
  // shows unopened auctions so managers can plan budgets across the window.
  if (systemSeedClaim?.opens_at && new Date().getTime() < new Date(systemSeedClaim.opens_at).getTime()) {
    const opensAt = new Date(systemSeedClaim.opens_at);
    return NextResponse.json(
      { error: `This auction opens on ${opensAt.toUTCString()}. Bidding is not open yet.` },
      { status: 400 },
    );
  }

  // ── Activity-based expiry calculation ────────────────────────────────────────
  const now = Date.now();
  // Market value no longer affects duration: deleting the hard ceiling removed
  // the only two places the big-transfer distinction fed (72h vs 96h ceiling,
  // 48h vs 96h initial window). Every auction now runs on the same decaying
  // timeout and a single 72h pre-first-bid window.
  const firstBidTime = systemSeedClaim?.first_bid_at ? new Date(systemSeedClaim.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, auctionSettings.quietHours);

  // Call the database RPC to place/upsert the bid atomically
  const { data: rpcRes, error: rpcError } = await admin.rpc('place_auction_bid_rpc', {
    p_league_id: leagueId,
    p_team_id: myTeam.id,
    p_player_id: playerId,
    p_drop_player_id: dropPlayerId || null,
    p_bid_amount: bidAmount,
    p_expires_at: new Date(expiresAt).toISOString(),
    p_now: new Date(now).toISOString(),
    p_expect_sale_listing_id: saleListingId || null,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as {
    success: boolean;
    error?: string;
    is_listing?: boolean;
    sale_listing_id?: string | null;
    is_buy_now?: boolean;
    expires_at?: string;
    cancelled_trade_count?: number;
    outbid_team_id?: string;
    outbid_team_name?: string;
    outbid_team_user_id?: string;
    outbid_user_email?: string;
    previous_highest_bid?: number;
  };

  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to place bid' }, { status: 400 });
  }

  // ── BUY NOW: resolve inline ──
  //
  // The RPC has already set every pending claim to expire, so the auction is
  // decided; it just needs someone to run the resolver. Waiting for the sweep
  // would be wrong — `process-auctions` is NOT in vercel.json, it is driven by
  // pg_cron every 10 minutes (019_auction_pgcron.sql), and an "instant" purchase
  // that takes up to ten minutes to show up is a bug users will report.
  //
  // Resolution failure is deliberately NOT fatal to the request: the bid itself
  // committed, and the sweep remains a correct (if slower) fallback. Reporting a
  // failure here would invite the user to buy again.
  let resolved = false;
  if (resData.is_buy_now) {
    try {
      const { lockedPlTeamIds } = await getLockedPlTeamIds();
      const { error: resolveErr } = await admin.rpc('resolve_single_player_auction_rpc', {
        p_league_id: leagueId,
        p_player_id: playerId,
        p_locked_pl_team_ids: lockedPlTeamIds,
      });
      if (resolveErr) {
        console.error('[bid] Buy Now inline resolution failed, leaving to sweep:', resolveErr);
      } else {
        resolved = true;
      }
    } catch (err) {
      console.error('[bid] Buy Now inline resolution threw, leaving to sweep:', err);
    }
  }

  // ── SEND OUTBID NOTIFICATION ──
  //
  // Skipped on Buy Now. The previous leader did lose, but "Outbid Warning! bid
  // again" is the wrong message for an auction that no longer exists — the
  // resolver sends them a proper "auction lost" notice instead.
  if (!resData.is_buy_now && resData.outbid_team_id && resData.outbid_team_user_id) {
    try {
      if (resData.outbid_user_email) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
        await sendEmail({
          to: [resData.outbid_user_email],
          subject: `Outbid! ${playerData?.name ?? 'A player'} auction update`,
          html: getOutbidEmail(
            playerData?.name ?? 'Unknown Player',
            bidAmount,
            `${baseUrl}/league/${leagueId}`
          )
        });
      }

      // Create in-game notification
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: resData.outbid_team_user_id,
        title: 'Outbid Warning!',
        content: `You have been outbid for **${playerData?.name ?? 'Unknown Player'}**. The new high bid is now **€${bidAmount}m**.`,
        url: `/league/${leagueId}/players`
      });
    } catch (err) {
      console.error('[bid] Failed to send outbid notifications:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    expires_at: resData.expires_at ?? new Date(expiresAt).toISOString(),
    is_listing: !!resData.is_listing,
    sale_listing_id: resData.sale_listing_id ?? null,
    is_buy_now: !!resData.is_buy_now,
    // False on a Buy Now whose inline resolution failed — the client should say
    // "completing…" rather than "you signed him", and wait for the sweep.
    resolved,
    cancelled_offers: resData.cancelled_trade_count ?? 0,
  });
}
