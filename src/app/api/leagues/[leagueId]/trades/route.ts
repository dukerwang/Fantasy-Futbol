import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { describeDeal } from '@/lib/transfers/describeDeal';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';

interface Props {
  params: Promise<{ leagueId: string }>;
}

type RosterPlayerLite = { id: string; name: string; web_name: string | null; primary_position: string; pl_team: string };

// GET: list trade proposals involving the user's team in this league
export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // All trade proposals where user's team is involved
  const { data: trades } = await admin
    .from('trade_proposals')
    .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
    .eq('league_id', leagueId)
    .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
    .order('created_at', { ascending: false });

  // Fetch all teams in this league (for the propose trade UI)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, user_id, faab_budget')
    .eq('league_id', leagueId)
    .neq('id', myTeam.id);

  // Fetch all rosters (to build split-screen proposal view)
  const allTeamIds = (allTeams ?? []).map((t) => t.id);
  const allRosters: Record<string, { id: string; name: string; web_name: string | null; primary_position: string; pl_team: string }[]> = {};

  if (allTeamIds.length > 0) {
    const { data: rosterEntries } = await admin
      .from('roster_entries')
      .select(`team_id, player:players(${FULL_PLAYER_SELECT})`)
      .in('team_id', allTeamIds);

    for (const entry of rosterEntries ?? []) {
      if (!allRosters[entry.team_id]) allRosters[entry.team_id] = [];
      allRosters[entry.team_id].push(entry.player as unknown as RosterPlayerLite);
    }
  }

  // My roster
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select(`player:players(${FULL_PLAYER_SELECT})`)
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => e.player as unknown as RosterPlayerLite);

  // Enrich trades with player details
  const allPlayerIds = new Set<string>();
  for (const t of trades ?? []) {
    (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }

  const playerMap: Record<string, { id: string; name: string; web_name: string | null; primary_position: string; pl_team: string }> = {};
  if (allPlayerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select(FULL_PLAYER_SELECT)
      .in('id', Array.from(allPlayerIds));

    for (const p of players ?? []) {
      playerMap[p.id] = p;
    }
  }

  return NextResponse.json({
    myTeam,
    trades: trades ?? [],
    allTeams: allTeams ?? [],
    allRosters,
    myRoster,
    playerMap,
  });
}

// POST: propose a new trade
export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    targetTeamId,
    offeredPlayerIds,
    requestedPlayerIds,
    offeredFaab,
    requestedFaab,
    message,
    parentTradeId,
    offeredRightIds = [],
    requestedRightIds = [],
  } = body as {
    targetTeamId: string;
    offeredPlayerIds: string[];
    requestedPlayerIds: string[];
    offeredFaab: number;
    requestedFaab: number;
    message?: string;
    parentTradeId?: string;
    /** departure_decisions.id values — retained player rights, not roster players. */
    offeredRightIds?: string[];
    requestedRightIds?: string[];
    /**
     * Set when this proposal is an offer against a sale listing. Ties the offer
     * to the listing so accepting it can close the listing and cancel its
     * auction in one transaction, and so the seller's gates can be enforced.
     */
    saleListingId?: string | null;
  };
  const { saleListingId } = body as { saleListingId?: string | null };

  if (!targetTeamId) return NextResponse.json({ error: 'targetTeamId is required' }, { status: 400 });
  if (!Array.isArray(offeredPlayerIds) || !Array.isArray(requestedPlayerIds)) {
    return NextResponse.json({ error: 'offeredPlayerIds and requestedPlayerIds must be arrays' }, { status: 400 });
  }
  if (!Array.isArray(offeredRightIds) || !Array.isArray(requestedRightIds)) {
    return NextResponse.json({ error: 'offeredRightIds and requestedRightIds must be arrays' }, { status: 400 });
  }
  // Rights count as substance: a deal that moves only a retained claim (for
  // budget, or for another claim) is a legitimate trade.
  if (
    offeredPlayerIds.length === 0 &&
    requestedPlayerIds.length === 0 &&
    offeredRightIds.length === 0 &&
    requestedRightIds.length === 0
  ) {
    return NextResponse.json({ error: 'A trade must include at least one player or retained right' }, { status: 400 });
  }
  if (typeof offeredFaab !== 'number' || offeredFaab < 0 || !Number.isInteger(offeredFaab)) {
    return NextResponse.json({ error: 'offeredFaab must be a non-negative integer' }, { status: 400 });
  }
  if (typeof requestedFaab !== 'number' || requestedFaab < 0 || !Number.isInteger(requestedFaab)) {
    return NextResponse.json({ error: 'requestedFaab must be a non-negative integer' }, { status: 400 });
  }

  // Neither side may come empty-handed. `describeDeal` calls this shape
  // 'one-sided' and the composer refuses to send it, but the rule belongs here
  // too — the composer is only today's caller, and a free transfer is almost
  // always an unfinished offer: a cash line added and left at zero looks
  // identical to a completed one until the recipient opens it.
  //
  // Cash counts as substance, so this fires only when a side puts up literally
  // nothing. Netting matters: €30m out against €30m back is €0m, which is not a
  // payment for the players coming the other way.
  const givesAssets = offeredPlayerIds.length > 0 || offeredRightIds.length > 0;
  const getsAssets = requestedPlayerIds.length > 0 || requestedRightIds.length > 0;
  const netFaab = offeredFaab - requestedFaab;

  if (!givesAssets && netFaab <= 0) {
    return NextResponse.json(
      { error: 'You are asking for players and putting nothing up — add a player, a retained right, or cash.' },
      { status: 400 },
    );
  }
  if (!getsAssets && netFaab >= 0) {
    return NextResponse.json(
      { error: 'You are giving players up and asking for nothing back — add a player, a retained right, or cash.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Verify caller's team
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget, team_name')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });
  if (myTeam.id === targetTeamId) return NextResponse.json({ error: 'Cannot trade with yourself' }, { status: 400 });

  // Enforce IR legality
  const { data: illegalIr } = await admin
    .from('roster_entries')
    .select('id, player:players(fpl_status)')
    .eq('team_id', myTeam.id)
    .eq('status', 'ir');

  if (illegalIr?.some(e => (e.player as unknown as { fpl_status: string | null })?.fpl_status === 'a')) {
    return NextResponse.json({ error: 'Cannot propose trades while you have a healthy player occupying an IR slot. Please activate them first.' }, { status: 400 });
  }

  // Verify target team is in this league
  const { data: targetTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget, user_id')
    .eq('id', targetTeamId)
    .eq('league_id', leagueId)
    .single();

  if (!targetTeam) return NextResponse.json({ error: 'Target team not found in this league' }, { status: 404 });

  if (offeredFaab > myTeam.faab_budget) {
    return NextResponse.json(
      { error: `You only have €${myTeam.faab_budget}m Club Balance — cannot offer €${offeredFaab}m` },
      { status: 400 },
    );
  }

  // Validate that offered players are actually on the proposer's roster, and
  // aren't out on loan — a loaned player's roster slot is governed by the loan
  // agreement, not by whichever club currently holds the roster_entries row.
  if (offeredPlayerIds.length > 0) {
    const { data: myPlayers } = await admin
      .from('roster_entries')
      .select('player_id, status')
      .eq('team_id', myTeam.id)
      .in('player_id', offeredPlayerIds);

    if ((myPlayers ?? []).length !== offeredPlayerIds.length) {
      return NextResponse.json({ error: 'One or more offered players are not on your roster' }, { status: 400 });
    }
    if ((myPlayers ?? []).some((e) => e.status === 'loan_in' || e.status === 'loan_out')) {
      return NextResponse.json({ error: 'One or more offered players are currently out on loan and cannot be traded' }, { status: 400 });
    }
  }

  // Validate that requested players are actually on the target team's roster
  if (requestedPlayerIds.length > 0) {
    const { data: theirPlayers } = await admin
      .from('roster_entries')
      .select('player_id, status')
      .eq('team_id', targetTeamId)
      .in('player_id', requestedPlayerIds);

    if ((theirPlayers ?? []).length !== requestedPlayerIds.length) {
      return NextResponse.json({ error: 'One or more requested players are not on the target team roster' }, { status: 400 });
    }
    if ((theirPlayers ?? []).some((e) => e.status === 'loan_in' || e.status === 'loan_out')) {
      return NextResponse.json({ error: 'One or more requested players are currently out on loan and cannot be traded' }, { status: 400 });
    }
  }

  // Validate retained rights are live and held by the side offering them.
  // The execute RPC re-checks this under lock at acceptance — a right can lapse
  // in between — but rejecting here gives the proposer a usable error instead of
  // a deal that silently dies days later.
  async function validateRights(rightIds: string[], holderTeamId: string, label: string) {
    if (rightIds.length === 0) return null;
    const { data: rights } = await admin
      .from('departure_decisions')
      .select('id')
      .eq('league_id', leagueId)
      .eq('team_id', holderTeamId)
      .in('status', ['retained', 'return_pending'])
      .in('id', rightIds);

    if ((rights ?? []).length !== rightIds.length) {
      return `One or more ${label} retained rights are no longer held or have lapsed`;
    }
    return null;
  }

  const rightsError =
    (await validateRights(offeredRightIds, myTeam.id, 'offered')) ??
    (await validateRights(requestedRightIds, targetTeamId, 'requested'));
  if (rightsError) return NextResponse.json({ error: rightsError }, { status: 400 });

  // Enforce player lock: cannot trade players with an active (locked) sale listing
  const allPlayerIds = [...offeredPlayerIds, ...requestedPlayerIds];
  if (allPlayerIds.length > 0) {
    const { data: lockedListings } = await admin
      .from('player_sale_listings')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('status', 'active')
      .in('player_id', allPlayerIds);

    if (lockedListings && lockedListings.length > 0) {
      const lockedIds = lockedListings.map(l => l.player_id);
      const { data: lockedPlayers } = await admin
        .from('players')
        .select('name')
        .in('id', lockedIds);
      const lockedNames = (lockedPlayers ?? []).map(p => p.name);
      return NextResponse.json(
        { error: `Cannot include locked players in a trade proposal: ${lockedNames.join(', ')} — bidding is live.` },
        { status: 400 }
      );
    }
  }

  // ── Offer against a sale listing ──────────────────────────────────────────
  //
  // What the seller says they are after is advertising, not a gate (088) — an
  // offer is never refused here for arriving in a shape they did not tick. Only
  // the auction's integrity is defended: see the `min_bid` floor below.
  if (saleListingId) {
    const { data: listing } = await admin
      .from('player_sale_listings')
      .select('id, seller_team_id, player_id, status, min_bid')
      .eq('id', saleListingId)
      .eq('league_id', leagueId)
      .maybeSingle();

    if (!listing) {
      return NextResponse.json({ error: 'That listing no longer exists.' }, { status: 404 });
    }
    if (listing.status !== 'pending') {
      return NextResponse.json(
        {
          error: listing.status === 'active'
            ? 'Bidding has started on this listing — it is now auction-only.'
            : `This listing is ${listing.status} and no longer accepting offers.`,
        },
        { status: 409 },
      );
    }
    // The seller must be the counterparty, and the listed player must actually
    // be part of what is being asked for. Without both, a listing id could be
    // pinned to an unrelated trade to borrow its acceptance path.
    if (listing.seller_team_id !== targetTeamId) {
      return NextResponse.json(
        { error: 'That listing belongs to a different club.' },
        { status: 400 },
      );
    }
    if (!requestedPlayerIds.includes(listing.player_id)) {
      return NextResponse.json(
        { error: 'An offer on a listing must request the listed player.' },
        { status: 400 },
      );
    }

    // The one rule that survived 088. A cash-only offer below `min_bid` is a way
    // to buy under the price the seller has already committed to publicly, which
    // undercuts their own auction — that is the market's integrity, not the
    // seller's taste, so it still binds. Offers including players are
    // deliberately unconstrained: their value is not a single number.
    //
    // A listing with no min_bid (114) has no public auction price to undercut —
    // it's release-clause-only or negotiation-only — so there is nothing for
    // this floor to defend. Any cash amount is the seller's call.
    const includesPlayers = offeredPlayerIds.length > 0 || offeredRightIds.length > 0;
    if (!includesPlayers && listing.min_bid != null && offeredFaab < listing.min_bid) {
      return NextResponse.json(
        { error: `A cash offer must be at least the minimum bid of €${listing.min_bid}m.` },
        { status: 400 },
      );
    }
  }

  if (parentTradeId) {
    const { data: parentTrade } = await admin
      .from('trade_proposals')
      .select('id, status')
      .eq('id', parentTradeId)
      .single();
    if (parentTrade && parentTrade.status === 'pending') {
      await admin.from('trade_proposals').update({ status: 'rejected' }).eq('id', parentTradeId);
    }
  }

  const { data: trade, error } = await admin
    .from('trade_proposals')
    .insert({
      league_id: leagueId,
      team_a_id: myTeam.id,
      team_b_id: targetTeamId,
      offered_players: offeredPlayerIds,
      requested_players: requestedPlayerIds,
      offered_rights: offeredRightIds,
      requested_rights: requestedRightIds,
      offered_faab: offeredFaab,
      requested_faab: requestedFaab,
      status: 'pending',
      message: message ?? null,
      parent_trade_id: parentTradeId ?? null,
      sale_listing_id: saleListingId ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // --- SEND IN-APP NOTIFICATION ---
  // In-app + push only — a proposal is routine, pre-decision noise (most get
  // countered or rejected); the completion email still fires once a trade
  // actually executes (see trades/[tradeId]/route.ts).
  try {
    // Fetch player names
    const allIds = [...offeredPlayerIds, ...requestedPlayerIds];
    const { data: players } = await admin.from('players').select('id, name').in('id', allIds);

    const offeredNames = offeredPlayerIds.map(id => players?.find(p => p.id === id)?.name || 'Unknown Player');
    const requestedNames = requestedPlayerIds.map(id => players?.find(p => p.id === id)?.name || 'Unknown Player');

    // Named before the cash is folded into the lists below, and with rights
    // counted so a rights-for-player deal is not mistaken for a cash sale.
    const { headline: dealName } = describeDeal({
      offered: [...offeredNames, ...offeredRightIds.map(() => 'retained rights')],
      requested: [...requestedNames, ...requestedRightIds.map(() => 'retained rights')],
      offeredFaab,
      requestedFaab,
    });

    if (offeredFaab > 0) offeredNames.push(`€${offeredFaab}m`);
    if (requestedFaab > 0) requestedNames.push(`€${requestedFaab}m`);

    // Create in-game notification for recipient manager
    const { createNotification } = await import('@/lib/notifications/createNotification');
    await createNotification(admin, {
      leagueId,
      userId: targetTeam.user_id,
      title: `${dealName} from ${myTeam.team_name}`,
      pushTitle: 'Trade Offer',
      content: `**${myTeam.team_name}** are offering: **${offeredNames.join(', ')}** in exchange for: **${requestedNames.join(', ')}**.${message ? ` Message: "${message}"` : ''}`,
      url: `/league/${leagueId}/transfers/deals`
    });

    // Send private DM to the target manager about the trade proposal. The
    // card itself is driven live off `trade_id` (see ChatClient/TradeOfferCard) —
    // this text is only a plain-language fallback for search/accessibility.
    await admin.from('chat_messages').insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: targetTeam.user_id, // Private DM to target manager only
      trade_id: trade.id,
      message: parentTradeId
        ? `${myTeam.team_name} sent a counter offer to ${targetTeam.team_name}`
        : saleListingId
          ? `${myTeam.team_name} made an offer on a listed player to ${targetTeam.team_name}`
          : `${myTeam.team_name} proposed a trade to ${targetTeam.team_name}`,
    });
  } catch (err) {
    console.error('Failed to send trade proposal notifications:', err);
  }

  return NextResponse.json({ trade }, { status: 201 });
}
