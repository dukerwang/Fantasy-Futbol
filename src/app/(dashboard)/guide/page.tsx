import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadUserGuide } from '@/lib/guide/loadUserGuide';
import GuideView from '@/components/settings/GuideView';

export const dynamic = 'force-dynamic';

export default async function GuidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const guide = await loadUserGuide();

  return (
    <GuideView
      settingsHref="/settings"
      markdown={'markdown' in guide ? guide.markdown : undefined}
      error={'error' in guide ? guide.error : undefined}
    />
  );
}
