import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadUserGuide } from '@/lib/guide/loadUserGuide';
import GuideView from '@/components/settings/GuideView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function LeagueGuidePage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/guide');

  const admin = createAdminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('id, commissioner_id')
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
    redirect('/guide');
  }

  const guide = await loadUserGuide();

  return (
    <GuideView
      settingsHref={`/league/${leagueId}/settings`}
      markdown={'markdown' in guide ? guide.markdown : undefined}
      error={'error' in guide ? guide.error : undefined}
    />
  );
}
