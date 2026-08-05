import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSeasonScaffold } from '@/lib/schedule/ensureSeasonScaffold';

interface Props {
  params: Promise<{ leagueId: string }>;
}

interface PickResult {
  success: boolean;
  code?: string;
  error?: string;
  http_status?: number;
  pick_id?: string;
  pick?: number;
  round?: number;
  team_id?: string;
  is_complete?: boolean;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { playerId, draftQueue, expectPick } = await req.json();
  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  const admin = createAdminClient();

  // Everything that used to live here — league status, who is on the clock,
  // ownership, player availability, roster size, and both inserts — now runs
  // inside make_draft_pick_rpc under a league-scoped advisory lock. Validating
  // in the route meant validating against a board that a concurrent auto-pick
  // could change before the insert landed (migration 108).
  const { data, error: rpcErr } = await admin.rpc('make_draft_pick_rpc', {
    p_league_id: leagueId,
    p_player_id: playerId,
    p_user_id: user.id,
    p_expect_pick: typeof expectPick === 'number' ? expectPick : null,
  });

  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const result = data as PickResult;
  if (!result?.success) {
    return NextResponse.json(
      { error: result?.error ?? 'Pick failed' },
      { status: result?.http_status ?? 400 },
    );
  }

  // The pick is committed. Everything below is presentation and fan-out — a
  // failure here must not be reported as a failed pick.
  const { data: newPick } = await admin
    .from('draft_picks')
    .select('*, player:players(*), team:teams(*)')
    .eq('id', result.pick_id!)
    .single();

  const broadcastChannel = admin.channel(`draft:${leagueId}`);
  await broadcastChannel.send({
    type: 'broadcast',
    event: 'new_pick',
    payload: newPick,
  });
  admin.removeChannel(broadcastChannel);

  // The RPC already flipped the league to 'active' on the final pick.
  if (result.is_complete) {
    const completeChannel = admin.channel(`draft:${leagueId}`);
    await completeChannel.send({
      type: 'broadcast',
      event: 'draft_complete',
      payload: { leagueId },
    });
    admin.removeChannel(completeChannel);
    // Schedule AND all three cup brackets — see ensureSeasonScaffold for why
    // these must not be called separately.
    await ensureSeasonScaffold(admin, leagueId);
  }

  return NextResponse.json({
    ...newPick,
    status: result.is_complete ? 'active' : 'drafting',
    draftQueue,
  });
}
