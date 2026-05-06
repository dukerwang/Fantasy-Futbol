/**
 * Admin Offseason Reset Page
 *
 * Commissioner-only. Fetches a pre-flight preview of the offseason reset,
 * shows exactly what will happen (prizes, relegation payouts), then
 * allows the commissioner to confirm and trigger the irreversible reset.
 *
 * Access: commissioner_id === current user only.
 */

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import OffseasonClient from './OffseasonClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function OffseasonAdminPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, status, current_season, previous_season, roster_locked, commissioner_id, prize_config')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Commissioner-only gate
  if (league.commissioner_id !== user.id) {
    redirect(`/league/${leagueId}`);
  }

  const cronSecret = process.env.CRON_SECRET ?? '';

  return (
    <OffseasonClient
      leagueId={leagueId}
      league={league as any}
      cronSecret={cronSecret}
    />
  );
}
