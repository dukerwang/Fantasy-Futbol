import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadHonoursBoard } from '@/lib/heritage/honoursBoard';
import CabinetsView from './CabinetsView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * Heritage — Trophy Cabinets.
 *
 * Replaces the old /clubs/[teamId]/honours page (removed), which showed one
 * club at a time and was
 * only reachable from that club's masthead — so in a league's first season no
 * cabinet was reachable at all. Every club stands here, decorated or not.
 */
export default async function CabinetsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, commissioner_id')
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

  const board = await loadHonoursBoard(admin, leagueId);

  return (
    <CabinetsView
      leagueId={leagueId}
      clubs={board.clubs}
      totalTrophies={board.totalTrophies}
      viewerTeamId={membership?.id ?? null}
    />
  );
}
