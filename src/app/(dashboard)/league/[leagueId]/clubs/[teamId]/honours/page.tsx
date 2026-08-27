import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { getClubHonours } from '@/lib/honours/getClubHonours';
import type { CrestConfig } from '@/components/crest/types';
import HonoursClient from './HonoursClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string; teamId: string }>;
}

/**
 * Any club's trophy cabinet, yours included.
 *
 * One route rather than two: your own masthead links here with your own team
 * id, the same way `clubs/[teamId]` already reuses ClubClient for both cases.
 * Named `honours` rather than a generic `collection` so that name stays free.
 */
export default async function HonoursPage({ params }: Props) {
  const { leagueId, teamId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Membership gate, matching every other page under /league/[leagueId]:
  // a cabinet is visible to the league, not to the internet.
  const [{ data: league }, { data: membership }] = await Promise.all([
    admin.from('leagues').select('id, name, commissioner_id').eq('id', leagueId).single(),
    admin.from('teams').select('id').eq('league_id', leagueId).eq('user_id', user.id).maybeSingle(),
  ]);
  if (!league) notFound();
  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  const { data: team } = await admin
    .from('teams')
    .select('id, team_name, crest_config, user:users!user_id(username)')
    .eq('league_id', leagueId)
    .eq('id', teamId)
    .maybeSingle();
  if (!team) notFound();

  const honours = (await getClubHonours(admin, leagueId, [teamId])).get(teamId) ?? [];

  return (
    <HonoursClient
      leagueId={leagueId}
      teamId={teamId}
      clubName={team.team_name}
      manager={(team as { user?: { username?: string } | null }).user?.username ?? 'Manager'}
      crestConfig={((team as { crest_config?: CrestConfig | null }).crest_config) ?? null}
      honours={honours}
    />
  );
}
