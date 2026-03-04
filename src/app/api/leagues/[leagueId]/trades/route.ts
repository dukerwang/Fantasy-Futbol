import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string }>;
}

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
  let allRosters: Record<string, { id: string; name: string; web_name: string | null; primary_position: string; pl_team: string }[]> = {};

  if (allTeamIds.length > 0) {
    const { data: rosterEntries } = await admin
      .from('roster_entries')
      .select('team_id, player:players(id, name, web_name, primary_position, secondary_positions, pl_team, market_value)')
      .in('team_id', allTeamIds);

    for (const entry of rosterEntries ?? []) {
      if (!allRosters[entry.team_id]) allRosters[entry.team_id] = [];
      allRosters[entry.team_id].push(entry.player as any);
    }
  }

  // My roster
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('player:players(id, name, web_name, primary_position, secondary_positions, pl_team, market_value)')
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => e.player as any);

  // Enrich trades with player details
  const allPlayerIds = new Set<string>();
  for (const t of trades ?? []) {
    (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }

  let playerMap: Record<string, { id: string; name: string; web_name: string | null; primary_position: string; pl_team: string }> = {};
  if (allPlayerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select('id, name, web_name, primary_position, secondary_positions, pl_team')
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
  const { targetTeamId, offeredPlayerIds, requestedPlayerIds, offeredFaab, requestedFaab, message } = body as {
    targetTeamId: string;
    offeredPlayerIds: string[];
    requestedPlayerIds: string[];
    offeredFaab: number;
    requestedFaab: number;
    message?: string;
  };

  if (!targetTeamId) return NextResponse.json({ error: 'targetTeamId is required' }, { status: 400 });
  if (!Array.isArray(offeredPlayerIds) || !Array.isArray(requestedPlayerIds)) {
    return NextResponse.json({ error: 'offeredPlayerIds and requestedPlayerIds must be arrays' }, { status: 400 });
  }
  if (offeredPlayerIds.length === 0 && requestedPlayerIds.length === 0) {
    return NextResponse.json({ error: 'A trade must include at least one player' }, { status: 400 });
  }
  if (typeof offeredFaab !== 'number' || offeredFaab < 0 || !Number.isInteger(offeredFaab)) {
    return NextResponse.json({ error: 'offeredFaab must be a non-negative integer' }, { status: 400 });
  }
  if (typeof requestedFaab !== 'number' || requestedFaab < 0 || !Number.isInteger(requestedFaab)) {
    return NextResponse.json({ error: 'requestedFaab must be a non-negative integer' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify caller's team
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });
  if (myTeam.id === targetTeamId) return NextResponse.json({ error: 'Cannot trade with yourself' }, { status: 400 });

  // Verify target team is in this league
  const { data: targetTeam } = await admin
    .from('teams')
    .select('id, faab_budget')
    .eq('id', targetTeamId)
    .eq('league_id', leagueId)
    .single();

  if (!targetTeam) return NextResponse.json({ error: 'Target team not found in this league' }, { status: 404 });

  // Validate proposer FAAB
  if (offeredFaab > myTeam.faab_budget) {
    return NextResponse.json(
      { error: `You only have £${myTeam.faab_budget}m FAAB — cannot offer £${offeredFaab}m` },
      { status: 400 },
    );
  }

  // Validate that offered players are actually on the proposer's roster
  if (offeredPlayerIds.length > 0) {
    const { data: myPlayers } = await admin
      .from('roster_entries')
      .select('player_id')
      .eq('team_id', myTeam.id)
      .in('player_id', offeredPlayerIds);

    if ((myPlayers ?? []).length !== offeredPlayerIds.length) {
      return NextResponse.json({ error: 'One or more offered players are not on your roster' }, { status: 400 });
    }
  }

  // Validate that requested players are actually on the target team's roster
  if (requestedPlayerIds.length > 0) {
    const { data: theirPlayers } = await admin
      .from('roster_entries')
      .select('player_id')
      .eq('team_id', targetTeamId)
      .in('player_id', requestedPlayerIds);

    if ((theirPlayers ?? []).length !== requestedPlayerIds.length) {
      return NextResponse.json({ error: 'One or more requested players are not on the target team roster' }, { status: 400 });
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
      offered_faab: offeredFaab,
      requested_faab: requestedFaab,
      status: 'pending',
      message: message ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ trade }, { status: 201 });
}
