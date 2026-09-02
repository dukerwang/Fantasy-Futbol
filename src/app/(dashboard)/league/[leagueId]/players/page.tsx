import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import type { Player } from '@/types';
import { getCurrentFplSeason, isFplSeasonKickedOff } from '@/lib/season/currentSeason';
import { loadSeasonLeaderboard } from '@/lib/stats/seasonStats';
import { loadExplorerRows, loadScoutIndex } from '@/lib/players/indexData';
import { isSiteAdminEmail } from '@/lib/auth/siteAdmin';
import { isPlayerMapped } from '@/lib/players/playerMapping';
import PlayersIndex from './PlayersIndex';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ view?: string; season?: string; gw?: string }>;
}

export interface IndexRowPlayer extends Player {
  owner_team_id: string | null;
  owner_team_name: string | null;
}

export default async function PlayersPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { view, season: requestedSeason, gw } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const isSiteAdmin = isSiteAdminEmail(user.email);
  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, current_season, previous_season')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  // Same resolution the stats page has always used, with an explicit override.
  let season = (league as { current_season?: string }).current_season ?? currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = (league as { previous_season?: string }).previous_season ?? season;
  }
  const seasons = [...new Set([currentFpl, (league as { previous_season?: string }).previous_season])]
    .filter((s): s is string => !!s)
    .sort()
    .reverse();
  if (requestedSeason && seasons.includes(requestedSeason)) season = requestedSeason;

  const { data: allTeams } = await admin.from('teams').select('id').eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id);

  const activeView = view === 'table' ? 'table' : view === 'explorer' ? 'explorer' : view === 'cards' ? 'cards' : undefined;

  // The explorer needs per-season aggregates the leaderboard does not carry,
  // and the scout layer is dead weight to it — load each only where used.
  // Which gameweeks the season actually has rows for — never a fixed 1..38,
  // which would offer weeks that have not been played.
  const { data: gwRows } = await admin
    .from('player_stats')
    .select('gameweek')
    .eq('season', season)
    .order('gameweek', { ascending: true });
  const gameweeks = [...new Set((gwRows ?? []).map((r) => r.gameweek as number))].filter(
    (n): n is number => n != null,
  );

  const requestedGw = gw ? Number(gw) : null;
  const gameweek = requestedGw != null && gameweeks.includes(requestedGw) ? requestedGw : null;

  const [{ players, shadowMaps }, scoutIndex, explorerRows] = await Promise.all([
    loadSeasonLeaderboard(admin, season, { gameweek }),
    activeView === 'explorer'
      ? Promise.resolve(new Map())
      : loadScoutIndex(admin),
    activeView === 'explorer' ? loadExplorerRows(admin, season) : Promise.resolve([]),
  ]);

  const ownerMap = new Map<string, { teamId: string; teamName: string }>();
  if (teamIds.length > 0) {
    const { data: rosterEntries } = await admin
      .from('roster_entries')
      .select('player_id, team:teams(id, team_name)')
      .in('team_id', teamIds);

    for (const entry of rosterEntries ?? []) {
      const team = entry.team as unknown as { id: string; team_name: string } | null;
      if (team) ownerMap.set(entry.player_id, { teamId: team.id, teamName: team.team_name });
    }
  }

  const rows: IndexRowPlayer[] = (players as Player[]).map((p) => {
    const owner = ownerMap.get(p.id) ?? null;
    return {
      ...p,
      owner_team_id: owner?.teamId ?? null,
      owner_team_name: owner?.teamName ?? null,
    };
  });

  const visibleRows = isSiteAdmin ? rows : rows.filter(isPlayerMapped);

  return (
    <PlayersIndex
      leagueId={leagueId}
      leagueName={league.name}
      players={visibleRows}
      scout={Object.fromEntries(scoutIndex)}
      season={season}
      seasons={seasons}
      view={activeView}
      explorerRows={explorerRows}
      gameweeks={gameweeks}
      gameweek={gameweek}
      shadowMaps={shadowMaps}
      isSiteAdmin={isSiteAdmin}
    />
  );
}
