import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import TeamSetupClient from './TeamSetupClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function TeamSetupPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Fetch league details
  const { data: league } = await admin
    .from('leagues')
    .select('name, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Fetch current user's team in this league
  const { data: team } = await admin
    .from('teams')
    .select('id, team_name, abbreviation, logo_url, crest_config')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  // If the user isn't in this league, send them back to the dashboard
  if (!team) {
    redirect('/dashboard');
  }

  // Fetch user profile username
  const { data: profile } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single();
  const username = profile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'Manager';

  return (
    <TeamSetupClient
      leagueId={leagueId}
      leagueName={league.name}
      team={team}
      username={username}
    />
  );
}
