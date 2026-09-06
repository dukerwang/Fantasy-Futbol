import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadAllResults } from '@/lib/heritage/results';
import { buildRecordBook } from '@/lib/heritage/records';
import { loadHonoursBoard } from '@/lib/heritage/honoursBoard';
import RecordBookView from './RecordBookView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * Heritage — Record Book.
 *
 * Every record carries its top three, so a figure reads as something clubs are
 * chasing rather than a number in a box.
 */
export default async function RecordsPage({ params }: Props) {
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

  const currentSeason = league.current_season ?? league.season;

  const [results, board] = await Promise.all([
    loadAllResults(admin, leagueId, currentSeason),
    loadHonoursBoard(admin, leagueId),
  ]);

  return (
    <RecordBookView
      leagueId={leagueId}
      records={buildRecordBook(results)}
      clubs={board.clubs.map((c) => ({
        teamId: c.teamId,
        teamName: c.teamName,
        crestConfig: c.crestConfig,
      }))}
      titles={board.clubs
        .map((c) => ({
          teamId: c.teamId,
          count: c.trophies.filter((t) => t.kind === 'league_title').length,
          seasons: c.trophies.filter((t) => t.kind === 'league_title').map((t) => t.season),
        }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)}
      viewerTeamId={membership?.id ?? null}
    />
  );
}
