import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSeasonScaffold } from '@/lib/schedule/ensureSeasonScaffold';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function POST(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;
  const admin = createAdminClient();

  // Call the new pg_cron headless function manually as a fail-safe trigger
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
