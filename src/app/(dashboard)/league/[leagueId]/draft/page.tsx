import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import DraftRoom from './DraftRoom';
import type { League, Team, Player, DraftPick } from '@/types';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function DraftPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Enforce membership
  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Redirect if not yet drafting (and not complete — completed draft can still be viewed)
  if (league.status === 'setup') redirect(`/league/${leagueId}`);

  // Fetch teams with draft_order
  const { data: teamsData } = await admin
    .from('teams')
    .select('id, league_id, user_id, team_name, faab_budget, total_points, draft_order, created_at, updated_at')
    .eq('league_id', leagueId)
    .order('draft_order', { ascending: true });

  const teams = (teamsData ?? []) as Team[];

  // Fetch all picks with player + team info
  const { data: picksData } = await admin
    .from('draft_picks')
    .select('*, player:players(*), team:teams(id, team_name, user_id, draft_order)')
    .eq('league_id', leagueId)
    .order('pick', { ascending: true });

  const picks = (picksData ?? []) as DraftPick[];

  // Fetch all active players for the picker (expanding the select to include rich data for PlayerCards)
  const { data: playersData } = await admin
    .from('players')
    .select(
      'id, web_name, name, primary_position, secondary_positions, pl_team, is_active, market_value, date_of_birth, nationality, height_cm, fpl_status, fpl_news, total_points, form, adp, projected_points, photo_url'
    )
    .eq('is_active', true)
    .order('market_value', { ascending: false });

  const players = (playersData ?? []) as Player[];

  // Determine the current user's team in this league
  const myTeam = teams.find((t) => t.user_id === user.id) ?? null;

  return (
    <DraftRoom
      leagueId={leagueId}
      league={league as League}
      teams={teams}
      initialPicks={picks}
      allPlayers={players as Player[]}
      myUserId={user.id}
      myTeam={myTeam}
    />
  );
}
