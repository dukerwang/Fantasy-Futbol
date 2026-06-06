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
    // Attempt schedule generation (idempotent, won't duplicate if cron beat us)
    await insertMatchups(admin, leagueId).catch(console.error);

    // Seed cup tournaments if they don't exist yet (brand new league)
    const { data: tourneys } = await admin
      .from('tournaments')
      .select('id')
      .eq('league_id', leagueId)
      .limit(1);

    if (!tourneys || tourneys.length === 0) {
      const { createAllTournaments } = await import('@/lib/tournaments/createTournaments');
      const { getCurrentFplSeason } = await import('@/lib/season/currentSeason');
      const season = league.current_season ?? await getCurrentFplSeason();
      await createAllTournaments(admin, leagueId, season).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true, draft_complete: isComplete, status: league?.status });
}
