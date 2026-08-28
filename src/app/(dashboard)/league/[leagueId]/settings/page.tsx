import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePrefs } from '@/lib/notifications/prefs';
import { isSiteAdminEmail } from '@/lib/auth/siteAdmin';
import SettingsClient from '@/components/settings/SettingsClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function LeagueSettingsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!myTeam && league.commissioner_id !== user.id) {
    redirect('/dashboard');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('notification_prefs')
    .eq('id', user.id)
    .single();

  return (
    <SettingsClient
      leagueId={leagueId}
      leagueName={league.name}
      isCommissioner={league.commissioner_id === user.id}
      isSiteAdmin={isSiteAdminEmail(user.email)}
      initialPrefs={resolvePrefs(profile?.notification_prefs)}
    />
  );
}
