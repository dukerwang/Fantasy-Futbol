import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolvePrefs } from '@/lib/notifications/prefs';
import SettingsClient from '@/components/settings/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('notification_prefs')
    .eq('id', user.id)
    .single();

  return <SettingsClient initialPrefs={resolvePrefs(profile?.notification_prefs)} />;
}
