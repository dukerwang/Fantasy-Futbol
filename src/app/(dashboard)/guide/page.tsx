import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { loadUserGuide } from '@/lib/guide/loadUserGuide';
import GuideView from '@/components/settings/GuideView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "The Gaffa Player's Guide",
  description: 'Official rules, scoring mechanics, transfer regulations, and tactics guide for Gaffa.',
};

export default async function GuidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const guide = await loadUserGuide();

  return (
    <GuideView
      settingsHref={user ? '/settings' : '/login'}
      isAuthenticated={!!user}
      markdown={'markdown' in guide ? guide.markdown : undefined}
      error={'error' in guide ? guide.error : undefined}
    />
  );
}
