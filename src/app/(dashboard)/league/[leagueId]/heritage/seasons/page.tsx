import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import { loadHonoursBoard } from '@/lib/heritage/honoursBoard';
import { loadSeasonXI } from '@/lib/heritage/seasonXI';
import SeasonsView from './SeasonsView';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ season?: string }>;
}

/**
 * Heritage — Seasons.
 *
 * Season by season: the podium, the cup winners, and the champion's
 * Title-Winning XI. Only archived seasons appear — the XI is derived from
 * archived lineups, and a title nobody has won has no winning side.
 */
export default async function SeasonsPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { season: requested } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, season, current_season, commissioner_id')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  const currentSeason = league.current_season ?? league.season;

  const [board, standingsRes, cupsRes] = await Promise.all([
    loadHonoursBoard(admin, leagueId),
    admin
      .from('season_standings_archive')
      .select('season, final_rank, total_points, team_id')
      .eq('league_id', leagueId)
      .order('season', { ascending: false })
      .order('final_rank', { ascending: true }),
    admin
      .from('season_cup_winners_archive')
      .select('season, tournament_name, tournament_type, winner_id')
      .eq('league_id', leagueId),
  ]);

  const standings = (standingsRes.data ?? []) as any[];
  const seasons = [...new Set(standings.map((s) => s.season as string))]
    .sort((a, b) => b.localeCompare(a));

  const selected = requested && seasons.includes(requested) ? requested : seasons[0] ?? null;

  const table = selected
    ? standings.filter((s) => s.season === selected).map((s) => ({
        rank: s.final_rank as number,
        teamId: s.team_id as string,
        points: Number(s.total_points ?? 0),
      }))
    : [];

  const cups = selected
    ? (cupsRes.data ?? [])
        .filter((c: any) => c.season === selected)
        .map((c: any) => ({
          name: c.tournament_name as string,
          type: c.tournament_type as string | null,
          winnerId: c.winner_id as string,
        }))
    : [];

  const championId = table.find((t) => t.rank === 1)?.teamId ?? null;
  const xi = selected && championId
    ? await loadSeasonXI(admin, leagueId, selected, championId)
    : null;

  return (
    <SeasonsView
      leagueId={leagueId}
      currentSeason={currentSeason}
      seasons={seasons}
      selected={selected}
      table={table}
      cups={cups}
      xi={xi}
      clubs={board.clubs.map((c) => ({
        teamId: c.teamId,
        teamName: c.teamName,
        managerName: c.managerName,
        crestConfig: c.crestConfig,
      }))}
      viewerTeamId={membership?.id ?? null}
    />
  );
}
