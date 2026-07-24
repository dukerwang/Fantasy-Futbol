/**
 * Platform Admin — Season Reset / Kickoff
 *
 * Site-admin only (see src/lib/auth/siteAdmin.ts) — distinct from any
 * league's commissioner. One switch each for "Reset every eligible league"
 * and "Kickoff every league waiting in offseason", across the whole
 * platform at once, rather than a per-league management list.
 */

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isSiteAdminEmail } from '@/lib/auth/siteAdmin';
import OffseasonAdminClient from './OffseasonAdminClient';

export const dynamic = 'force-dynamic';

export default async function PlatformOffseasonAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (!isSiteAdminEmail(user.email)) {
    redirect('/dashboard');
  }

  return <OffseasonAdminClient />;
}
