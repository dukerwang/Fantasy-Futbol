import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/** Returns the draft_order slot (1-indexed) for a given overall pick number in a snake draft. */
function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams); // 0-indexed round
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0
    ? posInRound + 1        // odd rounds (0,2,4…): 1→N
    : numTeams - posInRound; // even rounds (1,3,5…): N→1
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Verify league
  const { data: league } = await admin
    .from('leagues')
    .select('id, status, roster_size')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  if (league.status !== 'drafting') return NextResponse.json({ error: 'Draft is not active' }, { status: 400 });

  const { playerId } = await req.json();
  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  // Get all teams sorted by draft_order
  const { data: teams } = await admin
    .from('teams')
    .select('id, user_id, draft_order')
    .eq('league_id', leagueId)
    .order('draft_order', { ascending: true });

  if (!teams || teams.length === 0) {
    return NextResponse.json({ error: 'No teams found' }, { status: 400 });
  }

  const numTeams = teams.length;

  // Get existing picks
  const { data: existingPicks } = await admin
    .from('draft_picks')
    .select('id, team_id, player_id, picked_at')
    .eq('league_id', leagueId)
    .order('pick', { ascending: true });

  const picks = existingPicks ?? [];
  const totalPicks = numTeams * league.roster_size;

  if (picks.length >= totalPicks) {
    return NextResponse.json({ error: 'Draft is already complete' }, { status: 400 });
  }

  const pickNumber = picks.length + 1;

  // Determine which team is on the clock via snake formula
  const draftOrderSlot = snakeDraftOrder(pickNumber, numTeams);
  const currentTeam = teams.find((t) => t.draft_order === draftOrderSlot);

  if (!currentTeam) {
    return NextResponse.json({ error: 'Could not determine current team' }, { status: 500 });
  }

  // Validate caller owns the current team
  if (currentTeam.user_id !== user.id) {
    return NextResponse.json({ error: 'Not your pick' }, { status: 403 });
  }

  // Validate player is active
  const { data: player } = await admin
    .from('players')
    .select('id, is_active')
    .eq('id', playerId)
    .single();

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  if (!player.is_active) return NextResponse.json({ error: 'Player is not active' }, { status: 400 });

  // Check player not already drafted in this league
  if (picks.some((p) => p.player_id === playerId)) {
    return NextResponse.json({ error: 'Player already drafted' }, { status: 400 });
  }

  // Check team hasn't exceeded roster_size
  const teamPickCount = picks.filter((p) => p.team_id === currentTeam.id).length;
  if (teamPickCount >= league.roster_size) {
    return NextResponse.json({ error: 'Team roster is full' }, { status: 400 });
  }

  const round = Math.ceil(pickNumber / numTeams);

  // Insert into draft_picks
  const { data: newPick, error: pickErr } = await admin
    .from('draft_picks')
    .insert({
      league_id: leagueId,
      team_id: currentTeam.id,
      player_id: playerId,
      round,
      pick: pickNumber,
    })
    .select('*, player:players(*), team:teams(*)')
    .single();

  if (pickErr) return NextResponse.json({ error: pickErr.message }, { status: 500 });

  // Insert into roster_entries
  const { error: rosterErr } = await admin
    .from('roster_entries')
    .insert({
      team_id: currentTeam.id,
      player_id: playerId,
      status: 'bench',
      acquisition_type: 'draft',
    });

  if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 });

  // If this was the last pick, close the draft
  if (picks.length + 1 >= totalPicks) {
    await admin.from('leagues').update({ status: 'active' }).eq('id', leagueId);
  }

  return NextResponse.json(newPick);
}
