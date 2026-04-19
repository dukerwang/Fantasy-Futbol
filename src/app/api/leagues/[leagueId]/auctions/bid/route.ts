import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const AUCTION_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours
const ANTI_SNIPE_WINDOW_MS = 60 * 60 * 1000;      // 1 hour

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
    return NextResponse.json({ error: 'Insufficient FAAB budget' }, { status: 400 });
  }

  // Enforce IR legality
  const { data: illegalIr } = await admin
    .from('roster_entries')
    .select('id, player:players(fpl_status)')
    .eq('team_id', myTeam.id)
    .eq('status', 'ir');

  if (illegalIr?.some(e => (e.player as any)?.fpl_status === 'a')) {
    return NextResponse.json({ error: 'Cannot place a bid while you have a healthy player occupying an IR slot. Please activate them first.' }, { status: 400 });
  }

  // League settings for roster/academy validations
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, taxi_size, taxi_age_limit')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  // Season compliance: if the team has aged-out academy players, block new bids
  // until they are promoted/dropped (unless the manager is fixing it manually).
  const ageLimit = league.taxi_age_limit ?? 21;
  const { data: academyRows } = await admin
    .from('roster_entries')
    .select('player:players(name, date_of_birth)')
    .eq('team_id', myTeam.id)
    .eq('status', 'taxi');
  const agedOut = (academyRows ?? []).find((r: any) => {
    const dob = r.player?.date_of_birth as string | null | undefined;
    if (!dob) return false;
    return calculateAgeInYears(dob) > ageLimit;
  });
  if (agedOut) {
    const agedOutName = (agedOut as any).player?.name ?? 'A player';
    return NextResponse.json(
      { error: `Academy compliance required: ${agedOutName} has aged out. Promote or drop aged-out academy players before placing new bids.` },
      { status: 400 },
    );
  }

  // Transfermarkt minimum bid: 20% of the player's current market value
  const { data: playerData } = await admin
    .from('players')
    .select('market_value, name, date_of_birth')
    .eq('id', playerId)
    .single();

  const minimumBid = playerData ? Math.floor(Number(playerData.market_value || 0) * 0.2) : 0;
  if (minimumBid > 0 && bidAmount < minimumBid) {
    return NextResponse.json(
      { error: `Minimum bid for this player is £${minimumBid}m (20% of Transfermarkt value)` },
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

  // Current state of this auction (all pending bids for this player, highest first)
  const { data: existingClaims } = await admin
    .from('waiver_claims')
    .select('id, team_id, faab_bid, expires_at')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .order('faab_bid', { ascending: false });

  const highestClaim = existingClaims?.[0] ?? null;
  const myClaim = existingClaims?.find((c) => c.team_id === myTeam.id) ?? null;

  // Block bid if the auction has already expired (but is deferred in processing)
  if (highestClaim && new Date().getTime() >= new Date(highestClaim.expires_at).getTime()) {
    return NextResponse.json(
      { error: 'This auction has already expired and is awaiting processing.' },
      { status: 400 },
    );
  }

  // Bid must beat the current highest (unless the caller IS the current highest bidder)
  if (highestClaim && highestClaim.team_id !== myTeam.id && bidAmount <= highestClaim.faab_bid) {
    return NextResponse.json(
      { error: `Bid must be greater than the current highest bid of £${highestClaim.faab_bid}m` },
      { status: 400 },
    );
  }
  // If caller is already the highest bidder, they must raise their own bid
  if (myClaim && bidAmount <= myClaim.faab_bid) {
    return NextResponse.json(
      { error: `Your new bid must be greater than your current bid of £${myClaim.faab_bid}m` },
      { status: 400 },
    );
  }

  // Calculate the auction expiry
  const now = Date.now();
  let expiresAt: string;

  if (!highestClaim) {
    // First bid ever: start the 48-hour auction clock
    expiresAt = new Date(now + AUCTION_DURATION_MS).toISOString();
  } else {
    const currentExpiry = new Date(highestClaim.expires_at).getTime();
    const timeRemaining = currentExpiry - now;
    if (timeRemaining > 0 && timeRemaining < ANTI_SNIPE_WINDOW_MS) {
      // Anti-snipe: a bid in the final hour resets the clock to 1 hour from now
      expiresAt = new Date(now + ANTI_SNIPE_WINDOW_MS).toISOString();
    } else {
      // Keep the existing expiry
      expiresAt = highestClaim.expires_at;
    }
  }

  // Upsert the bid
  if (myClaim) {
    // Manager is raising their existing bid
    const { error } = await admin
      .from('waiver_claims')
      .update({
        faab_bid: bidAmount,
        drop_player_id: dropPlayerId ?? null,
        expires_at: expiresAt,
      })
      .eq('id', myClaim.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // New bid from this manager
    const { error } = await admin
      .from('waiver_claims')
      .insert({
        league_id: leagueId,
        team_id: myTeam.id,
        player_id: playerId,
        drop_player_id: dropPlayerId ?? null,
        faab_bid: bidAmount,
        priority: 999,
        status: 'pending',
        gameweek: 0, // auction bids are not gameweek-specific
        expires_at: expiresAt,
        is_auction: true,
      });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If the anti-snipe rule extended the expiry, propagate the new time to all bids for this player
  if (highestClaim && expiresAt !== highestClaim.expires_at) {
    await admin
      .from('waiver_claims')
      .update({ expires_at: expiresAt })
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .eq('status', 'pending')
      .eq('is_auction', true);
  }

  return NextResponse.json({ ok: true, expires_at: expiresAt });
}
