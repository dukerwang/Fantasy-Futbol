import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string; tradeId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, tradeId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action } = body as { action: 'accept' | 'reject' | 'cancel' };

  if (!['accept', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept, reject, or cancel' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the trade proposal with full player details
  const { data: trade } = await admin
    .from('trade_proposals')
    .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name, faab_budget, user_id),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name, faab_budget, user_id)
    `)
    .eq('id', tradeId)
    .eq('league_id', leagueId)
    .single();

  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.status !== 'pending') {
    return NextResponse.json({ error: `Trade is already ${trade.status}` }, { status: 400 });
  }

  const teamA = trade.team_a as any;
  const teamB = trade.team_b as any;

  // Authorization: only team_a can cancel, only team_b can accept/reject
  if (action === 'cancel') {
    if (teamA.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the trade proposer can cancel it' }, { status: 403 });
    }
    await admin.from('trade_proposals').update({ status: 'cancelled' }).eq('id', tradeId);
    return NextResponse.json({ ok: true });
  }

  if (teamB.user_id !== user.id) {
    return NextResponse.json({ error: 'Only the receiving team can accept or reject this trade' }, { status: 403 });
  }

  if (action === 'reject') {
    await admin.from('trade_proposals').update({ status: 'rejected' }).eq('id', tradeId);
    return NextResponse.json({ ok: true });
  }

  // ── ACCEPT: transactional validation + execution ──────────────────────────

  // Re-fetch teams to get fresh FAAB budgets
  const { data: freshTeamA } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('id', trade.team_a_id)
    .single();

  const { data: freshTeamB } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('id', trade.team_b_id)
    .single();

  if (!freshTeamA || !freshTeamB) {
    return NextResponse.json({ error: 'Could not verify team data' }, { status: 500 });
  }

  // 1. Verify offered players are still on team A
  if (trade.offered_players.length > 0) {
    const { data: teamAPlayers } = await admin
      .from('roster_entries')
      .select('player_id')
      .eq('team_id', trade.team_a_id)
      .in('player_id', trade.offered_players);

    if ((teamAPlayers ?? []).length !== trade.offered_players.length) {
      return NextResponse.json(
        { error: 'One or more offered players are no longer on the proposing team\'s roster. The trade cannot be completed.' },
        { status: 400 },
      );
    }
  }

  // 2. Verify requested players are still on team B
  if (trade.requested_players.length > 0) {
    const { data: teamBPlayers } = await admin
      .from('roster_entries')
      .select('player_id')
      .eq('team_id', trade.team_b_id)
      .in('player_id', trade.requested_players);

    if ((teamBPlayers ?? []).length !== trade.requested_players.length) {
      return NextResponse.json(
        { error: 'One or more requested players are no longer on your roster. The trade cannot be completed.' },
        { status: 400 },
      );
    }
  }

  // 3. Validate FAAB budgets
  if (trade.offered_faab > freshTeamA.faab_budget) {
    return NextResponse.json(
      { error: `The proposing team only has £${freshTeamA.faab_budget}m FAAB but offered £${trade.offered_faab}m. The trade cannot be completed.` },
      { status: 400 },
    );
  }
  if (trade.requested_faab > freshTeamB.faab_budget) {
    return NextResponse.json(
      { error: `You only have £${freshTeamB.faab_budget}m FAAB but the deal requires £${trade.requested_faab}m from your side.` },
      { status: 400 },
    );
  }

  // 4. Validate roster size constraints
  // Team A gives away offered_players.length, receives requested_players.length
  // Team B gives away requested_players.length, receives offered_players.length
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size')
    .eq('id', leagueId)
    .single();

  const rosterSize = league?.roster_size ?? 20;

  const { data: teamARoster } = await admin
    .from('roster_entries')
    .select('id')
    .eq('team_id', trade.team_a_id);

  const { data: teamBRoster } = await admin
    .from('roster_entries')
    .select('id')
    .eq('team_id', trade.team_b_id);

  const teamAAfter = (teamARoster ?? []).length - trade.offered_players.length + trade.requested_players.length;
  const teamBAfter = (teamBRoster ?? []).length - trade.requested_players.length + trade.offered_players.length;

  if (teamAAfter > rosterSize) {
    return NextResponse.json(
      { error: `Accepting this trade would put ${teamA.team_name} over the ${rosterSize}-player roster limit (they would have ${teamAAfter}). They must drop a player before this trade can be accepted.` },
      { status: 400 },
    );
  }
  if (teamBAfter > rosterSize) {
    return NextResponse.json(
      { error: `Accepting this trade would put your team over the ${rosterSize}-player roster limit (you would have ${teamBAfter}). Drop a player first before accepting.` },
      { status: 400 },
    );
  }

  // ── Execute the trade ──────────────────────────────────────────────────────

  const errors: string[] = [];

  // 5. Move offered_players from team A → team B
  if (trade.offered_players.length > 0) {
    const { error } = await admin
      .from('roster_entries')
      .update({ team_id: trade.team_b_id, acquisition_type: 'trade', acquired_at: new Date().toISOString() })
      .eq('team_id', trade.team_a_id)
      .in('player_id', trade.offered_players);
    if (error) errors.push(error.message);
  }

  // 6. Move requested_players from team B → team A
  if (trade.requested_players.length > 0) {
    const { error } = await admin
      .from('roster_entries')
      .update({ team_id: trade.team_a_id, acquisition_type: 'trade', acquired_at: new Date().toISOString() })
      .eq('team_id', trade.team_b_id)
      .in('player_id', trade.requested_players);
    if (error) errors.push(error.message);
  }

  // 7. Apply FAAB adjustments
  // Team A: loses offered_faab, gains requested_faab
  const teamANewFaab = freshTeamA.faab_budget - trade.offered_faab + trade.requested_faab;
  // Team B: loses requested_faab, gains offered_faab
  const teamBNewFaab = freshTeamB.faab_budget - trade.requested_faab + trade.offered_faab;

  const { error: faabErrA } = await admin
    .from('teams')
    .update({ faab_budget: teamANewFaab })
    .eq('id', trade.team_a_id);
  if (faabErrA) errors.push(faabErrA.message);

  const { error: faabErrB } = await admin
    .from('teams')
    .update({ faab_budget: teamBNewFaab })
    .eq('id', trade.team_b_id);
  if (faabErrB) errors.push(faabErrB.message);

  // 8. Update trade status
  const { error: tradeUpdateErr } = await admin
    .from('trade_proposals')
    .update({ status: 'accepted' })
    .eq('id', tradeId);
  if (tradeUpdateErr) errors.push(tradeUpdateErr.message);

  // 9. Log transactions for the league ledger
  const now = new Date().toISOString();
  const transactionInserts = [];

  for (const playerId of trade.offered_players) {
    // Team A traded out this player
    transactionInserts.push({
      league_id: leagueId,
      team_id: trade.team_a_id,
      player_id: playerId,
      type: 'trade' as const,
      notes: `Traded to ${teamB.team_name} (trade #${tradeId.slice(0, 8)})`,
      processed_at: now,
    });
    // Team B received this player
    transactionInserts.push({
      league_id: leagueId,
      team_id: trade.team_b_id,
      player_id: playerId,
      type: 'trade' as const,
      notes: `Received from ${teamA.team_name} (trade #${tradeId.slice(0, 8)})`,
      processed_at: now,
    });
  }

  for (const playerId of trade.requested_players) {
    // Team B traded out this player
    transactionInserts.push({
      league_id: leagueId,
      team_id: trade.team_b_id,
      player_id: playerId,
      type: 'trade' as const,
      notes: `Traded to ${teamA.team_name} (trade #${tradeId.slice(0, 8)})`,
      processed_at: now,
    });
    // Team A received this player
    transactionInserts.push({
      league_id: leagueId,
      team_id: trade.team_a_id,
      player_id: playerId,
      type: 'trade' as const,
      notes: `Received from ${teamB.team_name} (trade #${tradeId.slice(0, 8)})`,
      processed_at: now,
    });
  }

  if (transactionInserts.length > 0) {
    const { error: txErr } = await admin.from('transactions').insert(transactionInserts);
    if (txErr) errors.push(txErr.message);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
