import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertMatchups } from '@/lib/schedule/insertMatchups';

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
    .select('roster_size, status')
    .eq('id', leagueId)
    .single();

  const { count: teamCount } = await admin
    .from('teams')
    .select('id', { count: 'exact' })
    .eq('league_id', leagueId);

  const totalPicks = (teamCount ?? 0) * (league?.roster_size ?? 0);
  const isComplete = (picks?.length ?? 0) >= totalPicks;

  if (isComplete && league?.status === 'active') {
    // Attempt schedule generation (idempotent, won't duplicate if cron beat us)
    await insertMatchups(admin, leagueId).catch(console.error);
  }

  return NextResponse.json({ ok: true, draft_complete: isComplete, status: league?.status });
}
