import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import TradesClient from './TradesClient';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function TradesPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, roster_size, status')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();



  // Fetch all initial data from the trades API logic (same as GET /api/leagues/[id]/trades)
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) redirect('/dashboard');

  const { data: trades } = await admin
    .from('trade_proposals')
    .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
    .eq('league_id', leagueId)
    .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
    .order('created_at', { ascending: false });

  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .neq('id', myTeam.id);

  // Fetch rosters for all other teams (for propose UI)
  const allTeamIds = (allTeams ?? []).map((t) => t.id);
  let allRosters: Record<string, any[]> = {};
  if (allTeamIds.length > 0) {
    const { data: entries } = await admin
      .from('roster_entries')
      .select('team_id, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, adp, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form, form_rating, is_active, transfermarkt_id, created_at, updated_at)')
      .in('team_id', allTeamIds);

    for (const e of entries ?? []) {
      if (!allRosters[e.team_id]) allRosters[e.team_id] = [];
      allRosters[e.team_id].push(e.player as any);
    }
  }

  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, adp, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form, form_rating, is_active, transfermarkt_id, created_at, updated_at)')
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => e.player as any);

  // Build playerMap from all players in all trade proposals
  const allPlayerIds = new Set<string>();
  for (const t of trades ?? []) {
    (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }

  let playerMap: Record<string, any> = {};
  if (allPlayerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select('id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, adp, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form, form_rating, is_active, transfermarkt_id, created_at, updated_at')
      .in('id', Array.from(allPlayerIds));
    for (const p of players ?? []) {
      playerMap[p.id] = p;
    }
  }

  return (
    <TradesClient
      leagueId={leagueId}
      leagueName={league.name}
      myTeam={myTeam}
      myRoster={myRoster}
      allTeams={allTeams ?? []}
      allRosters={allRosters}
      initialTrades={trades ?? []}
      initialPlayerMap={playerMap}
    />
  );
}
