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
  const { playerId, bidAmount, dropPlayerId } = body as {
    playerId: string;
    bidAmount: number;
    dropPlayerId?: string | null;
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
    .select('roster_size, taxi_size, taxi_age_limit, roster_locked, previous_season')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
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

  // Promoted Club Exclusivity Check
  if (playerData?.pl_team) {
    const { data: systemClaim } = await admin
      .from('waiver_claims')
      .select('id')
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .is('team_id', null)
      .maybeSingle();

    if (systemClaim) {
      const previousSeason = league?.previous_season ?? '2025-26';
      
      const { data: prevPlayers } = await admin
        .from('players')
        .select('pl_team')
        .eq('pl_season', previousSeason);

      const prevTeams = new Set(prevPlayers?.map((p) => p.pl_team).filter(Boolean) ?? []);

      const isPromotedClub = prevTeams.size > 0 && !prevTeams.has(playerData.pl_team);

      if (isPromotedClub) {
        const { data: standingsArchive } = await admin
          .from('season_standings_archive')
          .select('team_id, final_rank')
          .eq('league_id', leagueId)
          .eq('season', previousSeason);

        const numTeamsInArchive = standingsArchive?.length ?? 0;
        const bottomHalfThreshold = numTeamsInArchive > 0 ? Math.ceil(numTeamsInArchive / 2) : 0;
        const bottomHalfTeamIds = new Set(
          standingsArchive
            ?.filter((s) => s.final_rank > bottomHalfThreshold)
            .map((s) => s.team_id) ?? []
        );

        if (bottomHalfTeamIds.size > 0 && !bottomHalfTeamIds.has(myTeam.id)) {
          return NextResponse.json(
            { error: `Bidding on newly promoted club players is restricted to bottom-half teams during the kickoff auction. Only bottom-half teams can bid on ${playerData.name} (${playerData.pl_team}) at this time.` },
            { status: 403 }
          );
        }
      }
    }
  }

  const minimumBid = playerData ? Math.floor(Number(playerData.market_value || 0) * 0.2) : 0;
  if (minimumBid > 0 && bidAmount < minimumBid) {
    return NextResponse.json(
      { error: `Minimum bid for this player is €${minimumBid}m (20% of Transfermarkt value)` },
      { status: 400 },
    );
  }

  // Roster capacity check.
  // If the active roster is full and no drop is nominated, we treat the bid as
  // "win directly into academy" and validate academy age + slot constraints.
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

  // Fetch system seed claim to check expiry and first bid time
  const { data: systemSeedClaim } = await admin
    .from('waiver_claims')
    .select('expires_at, first_bid_at')
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

  // ── Activity-based expiry calculation ────────────────────────────────────────
  const now = Date.now();
  const isBigTransfer = playerData && Number(playerData.market_value || 0) >= BIG_TRANSFER_THRESHOLD;
  const firstBidTime = systemSeedClaim?.first_bid_at ? new Date(systemSeedClaim.first_bid_at).getTime() : now;
  const expiresAt = calculateExpiresAt(firstBidTime, now, !!isBigTransfer);

  // Call the database RPC to place/upsert the bid atomically
  const { data: rpcRes, error: rpcError } = await admin.rpc('place_auction_bid_rpc', {
    p_league_id: leagueId,
    p_team_id: myTeam.id,
    p_player_id: playerId,
    p_drop_player_id: dropPlayerId || null,
    p_bid_amount: bidAmount,
    p_expires_at: new Date(expiresAt).toISOString(),
    p_now: new Date(now).toISOString(),
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as {
    success: boolean;
    error?: string;
    outbid_team_id?: string;
    outbid_team_name?: string;
    outbid_team_user_id?: string;
    outbid_user_email?: string;
    previous_highest_bid?: number;
  };

  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to place bid' }, { status: 400 });
  }

  // ── SEND OUTBID NOTIFICATION ──
  if (resData.outbid_team_id && resData.outbid_team_user_id) {
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

  return NextResponse.json({ ok: true, expires_at: new Date(expiresAt).toISOString() });
}
