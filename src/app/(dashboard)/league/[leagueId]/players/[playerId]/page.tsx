import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import { loadPlayerHub } from '@/lib/players/hubData';
import PlayerHub from './PlayerHub';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string; playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}

export default async function PlayerHubPage({ params, searchParams }: Props) {
  const { leagueId, playerId } = await params;
  const { season } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const hub = await loadPlayerHub(admin, playerId, leagueId, season ?? null);
  if (!hub) notFound();

  return <PlayerHub leagueId={leagueId} leagueName={league.name} data={hub} />;
}
