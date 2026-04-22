import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Option B: if user has exactly one league, go straight to it
  const admin = createAdminClient();
  const { data: teams } = await admin
    .from('teams')
    .select('league_id')
    .eq('user_id', user.id);

  if (teams && teams.length === 1) {
    redirect(`/league/${teams[0].league_id}`);
  }

  // Multiple leagues or no leagues → hub
  redirect('/dashboard');
}
