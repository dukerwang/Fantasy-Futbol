import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertMatchups } from '@/lib/schedule/insertMatchups';

interface Props {
  params: Promise<{ leagueId: string }>;
}

function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const round = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return round % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}

export async function POST(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;
  const admin = createAdminClient();

  // 1. Verify League Status
  const { data: league } = await admin
    .from('leagues')
    .select('id, status, roster_size')
    .eq('id', leagueId)
    .single();

  if (!league || league.status !== 'drafting') {
    return NextResponse.json({ error: 'Draft not active' }, { status: 400 });
  }

  // 2. Fetch Teams and Current Picks
  const { data: teams } = await admin
    .from('teams')
    .select('id, draft_order')
    .eq('league_id', leagueId)
    .order('draft_order', { ascending: true });

  const { data: picks } = await admin
    .from('draft_picks')
    .select('id, team_id, player_id')
    .eq('league_id', leagueId);

  const numTeams = teams?.length || 0;
  const totalPicks = numTeams * league.roster_size;
  const currentPicks = picks || [];

  if (currentPicks.length >= totalPicks) {
    return NextResponse.json({ draft_complete: true });
  }

  // 3. Determine Auto-Pick Target
  const pickNumber = currentPicks.length + 1;
  const draftOrderSlot = snakeDraftOrder(pickNumber, numTeams);
  const currentTeam = teams?.find((t) => t.draft_order === draftOrderSlot);

  if (!currentTeam) {
    return NextResponse.json({ error: 'Could not determine team on clock' }, { status: 500 });
  }

  // 4. Find Highest Value Available Player
  const draftedIds = currentPicks.map((p) => p.player_id);

  // Query top active players by market value
  const { data: topPlayers } = await admin
    .from('players')
    .select('id')
    .eq('is_active', true)
    .order('market_value', { ascending: false })
    .limit(250);

  const bestPlayer = topPlayers?.find((p) => !draftedIds.includes(p.id));

  if (!bestPlayer) {
    return NextResponse.json({ error: 'No players available to auto-pick' }, { status: 500 });
  }

  const round = Math.ceil(pickNumber / numTeams);

  // 5. Execute Pick Transaction (Unique constraint on (league_id, round, pick) handles race conditions cleanly)
  const { error: pickErr } = await admin.from('draft_picks').insert({
    league_id: leagueId,
    team_id: currentTeam.id,
    player_id: bestPlayer.id,
    round,
    pick: pickNumber,
  });

  if (pickErr) {
    // If it's a unique constraint violation, another request beat us to it, just return ok
    if (pickErr.code === '23505') {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: pickErr.message }, { status: 500 });
  }

  await admin.from('roster_entries').insert({
    team_id: currentTeam.id,
    player_id: bestPlayer.id,
    status: 'bench',
    acquisition_type: 'draft',
  });

  // 6. Complete Draft if Final Pick
  const isComplete = pickNumber >= totalPicks;
  if (isComplete) {
    await admin.from('leagues').update({ status: 'active' }).eq('id', leagueId);
    await insertMatchups(admin, leagueId).catch((err) =>
      console.error('[insertMatchups] auto-pick route error:', err)
    );
  }

  return NextResponse.json({ ok: true, draft_complete: isComplete });
}
