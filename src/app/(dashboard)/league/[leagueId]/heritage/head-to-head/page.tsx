import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadAllResults } from '@/lib/heritage/results';
import { loadHonoursBoard } from '@/lib/heritage/honoursBoard';
import { headToHead } from '@/lib/heritage/headToHead';
import RivalriesView from './RivalriesView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * Heritage — Head-to-Head index.
 *
 * Every pairing in the league, not just the viewer's, so a manager can settle
 * an argument about two other clubs. Six clubs is fifteen pairings; the whole
 * grid is computed in memory off one results fetch.
 */
export default async function HeadToHeadPage({ params }: Props) {
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
  const viewerTeamId = membership?.id ?? null;

  const [results, board] = await Promise.all([
    loadAllResults(admin, leagueId, currentSeason),
    loadHonoursBoard(admin, leagueId),
  ]);

  // Every unordered pair, once. Ordered from the viewer's side where the
  // viewer is in it, so their own record reads the right way round.
  const pairings = [];
  for (let i = 0; i < board.clubs.length; i++) {
    for (let j = i + 1; j < board.clubs.length; j++) {
      const a = board.clubs[i].teamId;
      const b = board.clubs[j].teamId;
      const from = b === viewerTeamId ? b : a;
      const to = from === a ? b : a;
      const h = headToHead(results, from, to);
      if (h.played > 0) pairings.push(h);
    }
  }
  pairings.sort((x, y) => {
    const mine = (h: typeof x) => (h.teamId === viewerTeamId || h.opponentId === viewerTeamId ? 0 : 1);
    return mine(x) - mine(y) || y.played - x.played;
  });

  return (
    <RivalriesView
      leagueId={leagueId}
      pairings={pairings}
      clubs={board.clubs.map((c) => ({
        teamId: c.teamId,
        teamName: c.teamName,
        managerName: c.managerName,
        crestConfig: c.crestConfig,
      }))}
      viewerTeamId={viewerTeamId}
    />
  );
}
