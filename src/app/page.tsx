import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Option B: if user is in exactly one league, go straight to it
  const admin = createAdminClient();
  const { data: teams } = await admin
    .from('teams')
    .select('league_id')
    .eq('user_id', user.id);

  const uniqueLeagueIds = [...new Set((teams ?? []).map(t => t.league_id))];

  if (uniqueLeagueIds.length === 1) {
    redirect(`/league/${uniqueLeagueIds[0]}`);
  }

  // Multiple leagues or no leagues → hub
  redirect('/dashboard');
}
