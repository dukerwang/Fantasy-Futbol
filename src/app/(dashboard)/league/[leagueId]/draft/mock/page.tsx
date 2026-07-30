import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import MockDraftRoom from './MockDraftRoom';
import type { League } from '@/types';
import { loadDraftPool } from '@/lib/draft/loadDraftPool';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function MockDraftPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Enforce membership
  const { data: membership } = await admin
    .from('teams')
    .select('id, team_name, abbreviation')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Same pool + shadow maps as the real draft room — table formatting and
  // player-card stats stay in lockstep with live drafting.
  const { players, shadowMaps } = await loadDraftPool(admin, league);

  return (
    <MockDraftRoom
      leagueId={leagueId}
      league={league as League}
      players={players}
      shadowMaps={shadowMaps}
      myTeamName={membership?.team_name ?? 'Your Club'}
    />
  );
}
