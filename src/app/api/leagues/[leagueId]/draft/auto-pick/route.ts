import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSeasonScaffold } from '@/lib/schedule/ensureSeasonScaffold';
import { snakeDraftOrder } from '@/lib/draft/snakeDraftOrder';

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

  // Picks made for THIS league before the sweep — compared against the count
  // after, so we can tell whether our invocation is the one that actually
  // advanced the clock (only one of the try-locked concurrent callers is).
  const { count: preCount } = await admin
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId);

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

  // An auto-pick landed for this league during this call — "you're on the
  // clock" for whoever it opened up to, same as the manual pick route. In-app
  // + push only. This covers the client-triggered fallback (every open Draft
  // Room fires this the instant its timer hits zero); the raw pg_cron sweep
  // (011) still resolves picks with nobody watching and has no HTTP/TS path
  // to hang a notification off, so that edge stays silent for now.
  if (!isComplete && (picks?.length ?? 0) > (preCount ?? 0) && teamCount) {
    try {
      const nextPickNumber = (picks?.length ?? 0) + 1;
      const nextRound = Math.ceil(nextPickNumber / teamCount);
      const nextSlot = snakeDraftOrder(nextPickNumber, teamCount);
      const { data: nextTeam } = await admin
        .from('teams')
        .select('user_id')
        .eq('league_id', leagueId)
        .eq('draft_order', nextSlot)
        .maybeSingle();

      if (nextTeam?.user_id) {
        const { createNotification } = await import('@/lib/notifications/createNotification');
        await createNotification(admin, {
          leagueId,
          userId: nextTeam.user_id,
          title: 'On the Clock',
          content: `**Round ${nextRound}, Pick ${nextPickNumber}** — you're up. Head to the Draft Room to make your pick.`,
          url: `/league/${leagueId}/draft`,
          tag: `draft-turn-${leagueId}`,
        });
      }
    } catch (err) {
      console.error('[draft/auto-pick] Failed to send on-the-clock notification:', err);
    }
  }

  if (isComplete && league?.status === 'active') {
    // Schedule + all three cup brackets. Both generators are idempotent, so
    // this won't duplicate anything if the SQL cron or a manual pick beat us.
    await ensureSeasonScaffold(admin, leagueId, league.current_season);
  }

  return NextResponse.json({ ok: true, draft_complete: isComplete, status: league?.status });
}
