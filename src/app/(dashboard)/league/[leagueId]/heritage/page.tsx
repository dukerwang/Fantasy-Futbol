import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadAllResults } from '@/lib/heritage/results';
import { loadHonoursBoard, reigningChampion } from '@/lib/heritage/honoursBoard';
import { allRivalries, overallRecord, winRate } from '@/lib/heritage/headToHead';
import HeritageOverview from './HeritageOverview';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * Heritage — Overview.
 *
 * Replaces /history. The league's record and the viewer's record against every
 * rival, on one page. See docs/superpowers/specs/2026-09-04-heritage-hub-design.md.
 *
 * One fetch of every result in the league, reduced in memory: the head-to-head
 * table would otherwise be one query per rival.
 */
export default async function HeritagePage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, season, current_season, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // `matchups` has no season column, so the live season has to be named for it.
  const currentSeason = league.current_season ?? league.season;

  const [board, results] = await Promise.all([
    loadHonoursBoard(admin, leagueId),
    loadAllResults(admin, leagueId, currentSeason),
  ]);

  const viewerTeamId = membership?.id ?? null;
  const champion = reigningChampion(board);

  // A commissioner who does not field a club still gets the league's half of
  // the page; only the personal half needs a club.
  const rivalries = viewerTeamId ? allRivalries(results, viewerTeamId) : [];
  const record = viewerTeamId ? overallRecord(results, viewerTeamId) : null;

  return (
    <HeritageOverview
      leagueId={leagueId}
      leagueName={league.name}
      currentSeason={currentSeason}
      board={board}
      champion={champion}
      viewerTeamId={viewerTeamId}
      rivalries={rivalries}
      record={record}
      winRate={record ? winRate(record) : 0}
    />
  );
}
