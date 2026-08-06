import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import { loadClubView } from '@/lib/teams/loadClubView';
import ClubClient from './ClubClient';
import styles from './club.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * Your own club. Identical to `/clubs/[teamId]` for any rival, except the
 * selector is "whichever team this user manages" — the loader does the rest and
 * hands back `viewerIsOwner: true`, which is what unlocks the actions.
 */
export default async function MyClubPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const props = await loadClubView(admin, leagueId, { userId: user.id }, user.id);

  if (!props) {
    return (
      <div className={styles.empty}>
        <h2>No team found</h2>
        <NavigationLink href="/dashboard">&larr; Back to Dashboard</NavigationLink>
      </div>
    );
  }

  return <ClubClient {...props} />;
}
