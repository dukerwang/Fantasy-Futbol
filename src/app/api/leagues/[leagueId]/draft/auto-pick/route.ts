import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSeasonScaffold } from '@/lib/schedule/ensureSeasonScaffold';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function POST(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // auto_pick_expired_drafts() is global — it sweeps every drafting league, not
  // just this one — and this endpoint used to be open to the internet with no
  // session check, so anyone could drive every live draft in the app at any
  // rate they liked. It is fired legitimately by browsers in the draft room
  // when the clock hits zero, so it cannot move behind CRON_SECRET; gate it on
  // membership of the league in the URL instead.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: membership } = await admin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 });

  // Fail-safe trigger for the pg_cron job. Concurrent invocations are expected
  // (011 schedules three overlapping jobs, and every open draft room calls
  // this); 108 makes the function take a per-league try-lock and skip rather
  // than race, so extra callers are harmless.
  const { error } = await admin.rpc('auto_pick_expired_drafts');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Determine if draft just completed so we can trigger matchups schedule if needed
  const { data: picks } = await admin
    .from('draft_picks')
    .select('id')
    .eq('league_id', leagueId);

  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, status, current_season')
    .eq('id', leagueId)
    .single();

  const { count: teamCount } = await admin
    .from('teams')
    .select('id', { count: 'exact' })
    .eq('league_id', leagueId);

  const totalPicks = (teamCount ?? 0) * (league?.roster_size ?? 0);
  const isComplete = (picks?.length ?? 0) >= totalPicks;

  if (isComplete && league?.status === 'active') {
    // Schedule + all three cup brackets. Both generators are idempotent, so
    // this won't duplicate anything if the SQL cron or a manual pick beat us.
    await ensureSeasonScaffold(admin, leagueId, league.current_season);
  }

  return NextResponse.json({ ok: true, draft_complete: isComplete, status: league?.status });
}
