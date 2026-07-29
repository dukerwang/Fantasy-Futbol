import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import GlobalStatsTable from './GlobalStatsTable';
import type { Player } from '@/types';
import { getCurrentFplSeason, isFplSeasonKickedOff } from '@/lib/season/currentSeason';
import { loadSeasonLeaderboard } from '@/lib/stats/seasonStats';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export interface StatPlayer extends Player {
  owner_team_id: string | null;
  owner_team_name: string | null;
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
    .select('id, name, current_season, previous_season')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  let season = (league as any).current_season ?? currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = (league as any).previous_season ?? season;
  }

  // All teams in this league
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id);

  const { players, shadowMaps } = await loadSeasonLeaderboard(admin, season);

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

  // Merge owners
  const statPlayers: StatPlayer[] = players.map((p: any) => {
    const owner = ownerMap.get(p.id) ?? null;
    return {
      ...p,
      owner_team_id: owner?.teamId ?? null,
      owner_team_name: owner?.teamName ?? null,
    };
  });

  return (
    <GlobalStatsTable
      leagueId={leagueId}
      leagueName={league.name}
      players={statPlayers}
      shadowMaps={shadowMaps}
    />
  );
}
