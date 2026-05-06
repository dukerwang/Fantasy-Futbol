import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import GlobalStatsTable from './GlobalStatsTable';
import type { Player } from '@/types';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export interface StatPlayer extends Player {
  owner_team_id: string | null;
  owner_team_name: string | null;
  games_played: number;
}

export default async function StatsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Validate league
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, current_season')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const season = (league as any).current_season ?? await getCurrentFplSeason();

  // All teams in this league
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id);

  // Fetch all active players ordered by total_points desc
  // Fetch all active players and rankings separately
  const [{ data: playersData }, { data: rankings }] = await Promise.all([
    admin.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true).order('total_points', { ascending: false, nullsFirst: false }) as any,
    admin.from('player_rankings').select('*')
  ]);

  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
  const players = (playersData ?? []).map((p: any) => {
    const ranks = rankMap.get(p.id);
    return {
      ...p,
      overall_rank: ranks?.overall_rank,
      position_ranks: ranks?.position_ranks
    };
  });

  // Roster entries for this league → owner map
  const ownerMap = new Map<string, { teamId: string; teamName: string }>();
  if (teamIds.length > 0) {
    const { data: rosterEntries } = await admin
      .from('roster_entries')
      .select('player_id, team:teams(id, team_name)')
      .in('team_id', teamIds);

    for (const entry of rosterEntries ?? []) {
      const team = entry.team as any;
      if (team) {
        ownerMap.set(entry.player_id, { teamId: team.id, teamName: team.team_name });
      }
    }
  }

  // Fetch games_played counts from player_stats (paginated — Supabase row limit 1000)
  const allStats: { player_id: string }[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await admin
      .from('player_stats')
      .select('player_id')
      .eq('season', season)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!data || data.length === 0) break;
    allStats.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const gamesPlayedMap = new Map<string, number>();
  for (const row of allStats) {
    gamesPlayedMap.set(row.player_id, (gamesPlayedMap.get(row.player_id) ?? 0) + 1);
  }

  // Merge — use pre-computed form_rating from players table for form display
  const statPlayers: StatPlayer[] = (players ?? []).map((p: any) => {
    const owner = ownerMap.get(p.id) ?? null;
    return {
      ...p,
      form: p.form_rating, // use pre-computed rating average
      ppg: p.ppg,
      owner_team_id: owner?.teamId ?? null,
      owner_team_name: owner?.teamName ?? null,
      games_played: gamesPlayedMap.get(p.id) ?? 0,
    };
  });

  return (
    <GlobalStatsTable
      leagueId={leagueId}
      leagueName={league.name}
      players={statPlayers}
    />
  );
}
