import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET: fetch chat logs for the league (Lobby + User DMs)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('league_id');
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify that the user is actually a member of the league (has a team or is the commissioner)
  const { data: league } = await admin
    .from('leagues')
    .select('commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam && league.commissioner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch all managers/teams in this league to enrich the sender context on the frontend
  const { data: leagueTeams } = await admin
    .from('teams')
    .select(`
      id, team_name, user_id, abbreviation, crest_config,
      user:users(id, username, avatar_url)
    `)
    .eq('league_id', leagueId);

  // Fetch messages:
  // - Public messages (recipient_id IS NULL)
  // - Private DMs sent TO the user (recipient_id = user.id)
  // - Private DMs sent BY the user (sender_id = user.id)
  const { data: messages, error } = await admin
    .from('chat_messages')
    .select(`
      *,
      sender:users!chat_messages_sender_id_fkey(id, username, avatar_url)
    `)
    .eq('league_id', leagueId)
    .or(`recipient_id.is.null,recipient_id.eq.${user.id},sender_id.eq.${user.id}`)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Batch-resolve live trade/loan negotiation summaries for any messages that
  // reference one, so the client can render an always-current card instead of
  // trusting a snapshot embedded at proposal time.
  const tradeIds = Array.from(new Set((messages ?? []).map((m) => m.trade_id).filter((id): id is string => !!id)));
  const loanIds = Array.from(new Set((messages ?? []).map((m) => m.loan_id).filter((id): id is string => !!id)));

  interface TradeSummary {
    id: string;
    status: string;
    teamAId: string;
    teamAName: string;
    teamBId: string;
    teamBName: string;
    offeredPlayers: { id: string; name: string }[];
    requestedPlayers: { id: string; name: string }[];
    offeredRights: { id: string; name: string }[];
    requestedRights: { id: string; name: string }[];
    offeredFaab: number;
    requestedFaab: number;
    saleListingId: string | null;
    parentTradeId: string | null;
    message: string | null;
    createdAt: string;
  }

  const trades: Record<string, TradeSummary> = {};
  if (tradeIds.length > 0) {
    const { data: tradeRows } = await admin
      .from('trade_proposals')
      .select(`
        id, status, team_a_id, team_b_id, offered_players, requested_players,
        offered_rights, requested_rights, offered_faab, requested_faab,
        sale_listing_id, parent_trade_id, message, created_at,
        team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
        team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
      `)
      .eq('league_id', leagueId)
      .in('id', tradeIds);

    const allPlayerIds = new Set<string>();
    const allRightIds = new Set<string>();
    for (const t of tradeRows ?? []) {
      (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
      (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
      (t.offered_rights ?? []).forEach((id: string) => allRightIds.add(id));
      (t.requested_rights ?? []).forEach((id: string) => allRightIds.add(id));
    }

    const playerNameMap: Record<string, string> = {};
    if (allPlayerIds.size > 0) {
      const { data: players } = await admin.from('players').select('id, name').in('id', Array.from(allPlayerIds));
      for (const p of players ?? []) playerNameMap[p.id] = p.name;
    }

    const rightNameMap: Record<string, string> = {};
    if (allRightIds.size > 0) {
      const { data: rights } = await admin
        .from('departure_decisions')
        .select('id, player:players(name)')
        .in('id', Array.from(allRightIds));
      for (const r of rights ?? []) rightNameMap[r.id] = (r.player as unknown as { name: string } | null)?.name ?? 'Unknown Player';
    }

    for (const t of tradeRows ?? []) {
      trades[t.id] = {
        id: t.id,
        status: t.status,
        teamAId: t.team_a_id,
        teamAName: (t.team_a as unknown as { team_name: string } | null)?.team_name ?? 'Unknown Club',
        teamBId: t.team_b_id,
        teamBName: (t.team_b as unknown as { team_name: string } | null)?.team_name ?? 'Unknown Club',
        offeredPlayers: (t.offered_players ?? []).map((id: string) => ({ id, name: playerNameMap[id] ?? 'Unknown Player' })),
        requestedPlayers: (t.requested_players ?? []).map((id: string) => ({ id, name: playerNameMap[id] ?? 'Unknown Player' })),
        offeredRights: (t.offered_rights ?? []).map((id: string) => ({ id, name: rightNameMap[id] ?? 'Unknown Player' })),
        requestedRights: (t.requested_rights ?? []).map((id: string) => ({ id, name: rightNameMap[id] ?? 'Unknown Player' })),
        offeredFaab: t.offered_faab,
        requestedFaab: t.requested_faab,
        saleListingId: t.sale_listing_id,
        parentTradeId: t.parent_trade_id,
        message: t.message,
        createdAt: t.created_at,
      };
    }
  }

  interface LoanSummary {
    id: string;
    status: string;
    lenderTeamId: string;
    lenderTeamName: string;
    borrowerTeamId: string;
    borrowerTeamName: string;
    playerId: string;
    playerName: string;
    loanFee: number;
    startGameweek: number;
    endGameweek: number;
    bonusRate: number;
    bonusCap: number;
    hasRecall: boolean;
    proposedBy: string;
    parentLoanId: string | null;
    message: string | null;
    createdAt: string;
  }

  const loans: Record<string, LoanSummary> = {};
  if (loanIds.length > 0) {
    const { data: loanRows } = await admin
      .from('player_loans')
      .select(`
        id, status, lender_team_id, borrower_team_id, player_id, loan_fee,
        start_gameweek, end_gameweek, bonus_rate, bonus_cap, has_recall,
        proposed_by, parent_loan_id, message, created_at,
        lender_team:teams!lender_team_id(id, team_name),
        borrower_team:teams!borrower_team_id(id, team_name),
        player:players(id, name)
      `)
      .eq('league_id', leagueId)
      .in('id', loanIds);

    for (const l of loanRows ?? []) {
      loans[l.id] = {
        id: l.id,
        status: l.status,
        lenderTeamId: l.lender_team_id,
        lenderTeamName: (l.lender_team as unknown as { team_name: string } | null)?.team_name ?? 'Unknown Club',
        borrowerTeamId: l.borrower_team_id,
        borrowerTeamName: (l.borrower_team as unknown as { team_name: string } | null)?.team_name ?? 'Unknown Club',
        playerId: l.player_id,
        playerName: (l.player as unknown as { name: string } | null)?.name ?? 'Unknown Player',
        loanFee: l.loan_fee,
        startGameweek: l.start_gameweek,
        endGameweek: l.end_gameweek,
        bonusRate: l.bonus_rate,
        bonusCap: l.bonus_cap,
        hasRecall: l.has_recall,
        proposedBy: l.proposed_by,
        parentLoanId: l.parent_loan_id,
        message: l.message,
        createdAt: l.created_at,
      };
    }
  }

  return NextResponse.json({
    messages: messages ?? [],
    teams: leagueTeams ?? [],
    trades,
    loans,
  });
}

// POST: send a chat message
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { leagueId, message, recipientId } = body as {
    leagueId: string;
    message: string;
    recipientId?: string | null;
  };

  if (!leagueId || !message?.trim()) {
    return NextResponse.json({ error: 'leagueId and message are required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify that the sender is a member of the league (has a team or is the commissioner)
  const { data: league } = await admin
    .from('leagues')
    .select('commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam && league.commissioner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Insert chat message
  const { data: chatMsg, error } = await admin
    .from('chat_messages')
    .insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: recipientId || null,
      message: message.trim(),
    })
    .select(`
      *,
      sender:users!chat_messages_sender_id_fkey(id, username, avatar_url)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: chatMsg });
}
