import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadClubView } from '@/lib/teams/loadClubView';
import ClubClient from '../../team/roster/ClubClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string; teamId: string }>;
}

/**
 * Any club in the league, yours included.
 *
 * The same component the owner sees, minus every control — `loadClubView`
 * resolves `viewerIsOwner` off the row it fetched, so a manager who lands on
 * their own club here gets the full page rather than a hobbled copy of it.
 */
export default async function ClubPage({ params }: Props) {
  const { leagueId, teamId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Membership gate, matching every other page under /league/[leagueId]:
  // rosters are visible to the league, not to the internet.
  const [{ data: league }, { data: membership }] = await Promise.all([
    admin.from('leagues').select('id, commissioner_id').eq('id', leagueId).single(),
    admin.from('teams').select('id').eq('league_id', leagueId).eq('user_id', user.id).maybeSingle(),
  ]);
  if (!league) notFound();
  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  const props = await loadClubView(admin, leagueId, { teamId }, user.id);
  if (!props) notFound();

  return <ClubClient {...props} />;
}
