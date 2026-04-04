import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import ActivityClient from './ActivityClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function ActivityPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('name, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam && league.commissioner_id !== user.id) redirect('/dashboard');

  const [txResult, teamsResult, auctionsResult] = await Promise.all([
    admin
      .from('transactions')
      .select(
        `id, type, faab_bid, compensation_amount, notes, processed_at,
         team:teams(id, team_name),
         player:players(id, web_name, name, primary_position, photo_url, pl_team)`
      )
      .eq('league_id', leagueId)
      .order('processed_at', { ascending: false })
      .limit(100),
    admin
      .from('teams')
      .select('id, team_name, faab_budget, user:users(username)')
      .eq('league_id', leagueId)
      .order('faab_budget', { ascending: false }),
    admin
      .from('waiver_claims')
      .select(
        `id, faab_bid, created_at,
         player:players(id, web_name, name, primary_position, photo_url, pl_team),
         team:teams(id, team_name)`
      )
      .eq('league_id', leagueId)
      .eq('status', 'pending')
      .order('faab_bid', { ascending: false }),
  ]);

  return (
    <ActivityClient
      leagueId={leagueId}
      leagueName={league.name}
      myTeamId={myTeam?.id ?? null}
      transactions={(txResult.data ?? []) as any[]}
      teams={(teamsResult.data ?? []) as any[]}
      liveAuctions={(auctionsResult.data ?? []) as any[]}
    />
  );
}
