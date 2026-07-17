import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import CrestEditClient from './CrestEditClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function EditCrestPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Fetch current user's team in this league
  const { data: team } = await admin
    .from('teams')
    .select('id, team_name, abbreviation, crest_config')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  // If user doesn't have a team in this league, block them
  if (!team) {
    redirect('/dashboard');
  }

  return (
    <CrestEditClient
      leagueId={leagueId}
      team={team}
    />
  );
}
