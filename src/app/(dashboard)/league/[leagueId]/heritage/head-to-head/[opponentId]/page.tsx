import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadAllResults } from '@/lib/heritage/results';
import { loadHonoursBoard } from '@/lib/heritage/honoursBoard';
import { headToHead } from '@/lib/heritage/headToHead';
import PairingView from './PairingView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string; opponentId: string }>;
  searchParams: Promise<{ from?: string }>;
}

/**
 * Heritage — one pairing.
 *
 * Read from the viewer's club by default. `?from=<teamId>` picks the other
 * side, which is how the index links a pairing the viewer is not part of.
 */
export default async function PairingPage({ params, searchParams }: Props) {
  const { leagueId, opponentId } = await params;
  const { from } = await searchParams;

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

  const opponent = board.clubs.find((c) => c.teamId === opponentId);
  if (!opponent) notFound();

  // Whose side the page reads from: the explicit ?from, else the viewer's own
  // club, else the most decorated club that is not the opponent — a
  // commissioner with no team still gets a readable page.
  const fallback = board.clubs.find((c) => c.teamId !== opponentId);
  const fromId =
    (from && board.clubs.some((c) => c.teamId === from) && from !== opponentId ? from : null) ??
    (membership?.id && membership.id !== opponentId ? membership.id : null) ??
    fallback?.teamId ??
    null;

  if (!fromId) notFound();

  const subject = board.clubs.find((c) => c.teamId === fromId)!;

  return (
    <PairingView
      leagueId={leagueId}
      h2h={headToHead(results, fromId, opponentId)}
      subject={{
        teamId: subject.teamId,
        teamName: subject.teamName,
        managerName: subject.managerName,
        crestConfig: subject.crestConfig,
        trophies: subject.trophies,
      }}
      opponent={{
        teamId: opponent.teamId,
        teamName: opponent.teamName,
        managerName: opponent.managerName,
        crestConfig: opponent.crestConfig,
        trophies: opponent.trophies,
      }}
      isViewer={subject.teamId === membership?.id}
    />
  );
}
