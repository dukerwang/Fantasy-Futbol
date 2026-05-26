import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import ChatClient from './ChatClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function ChatPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Verify the league exists
  const { data: league } = await admin
    .from('leagues')
    .select('name, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Verify the user is a member of the league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  // Commissioners are allowed in chat even if they don't have an active team in the league
  if (!myTeam && league.commissioner_id !== user.id) {
    redirect('/dashboard');
  }

  // Fetch the current user's username
  const { data: profile } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single();

  const username = profile?.username || 'Manager';

  return (
    <ChatClient
      leagueId={leagueId}
      leagueName={league.name}
      currentUserId={user.id}
      currentUsername={username}
    />
  );
}
