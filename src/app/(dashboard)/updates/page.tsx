import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProductUpdates } from '@/lib/updates/getProductUpdates';
import UpdatesView from '@/components/settings/UpdatesView';

export const dynamic = 'force-dynamic';

export default async function UpdatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const updates = await getProductUpdates(admin);

  return <UpdatesView updates={updates} />;
}
