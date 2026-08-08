import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import HistoryClient from './HistoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function HistoryPage({ params }: Props) {
  const { leagueId } = await params;

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

  // Auth: must be a member or commissioner
  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // ── Parallel data fetches ──────────────────────────────────────────────────
  const [archiveResult, allMatchupsResult, cupWinnersResult] = await Promise.all([
    // Season standings archive
    admin
      .from('season_standings_archive')
      .select(
        `season, final_rank, total_points, archived_at,
         team:teams!team_id(id, team_name, crest_config, user:users!user_id(username))`
      )
      .eq('league_id', leagueId)
      .order('season', { ascending: false })
      .order('final_rank', { ascending: true }),

    // All completed matchups for all-time records from archives
    admin
      .from('season_matchups_archive')
      .select('score_a, score_b, gameweek, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
      .eq('league_id', leagueId),

    // Completed tournament cup winners from archives
    admin
      .from('season_cup_winners_archive')
      .select('tournament_name, season, winner:teams!winner_id(team_name)')
      .eq('league_id', leagueId),
  ]);

  const archive = archiveResult.data ?? [];
  const allMatchups = allMatchupsResult.data ?? [];
  const cupWinners = cupWinnersResult.data ?? [];

  // ── Resolve cup winners from archive ──────────────────────────────────────
  const cupWinnerData = cupWinners.map((cw: any) => ({
    tournament_name: cw.tournament_name,
    season: cw.season,
    winner_name: cw.winner?.team_name ?? 'Unknown',
  }));

  // ── Compute all-time record: highest single-GW score ──────────────────────
  let highestGwScore: { teamName: string; score: number; gameweek: number } | null = null;
  for (const m of allMatchups as any[]) {
    const scoreA = Number(m.score_a ?? 0);
    const scoreB = Number(m.score_b ?? 0);
    if (scoreA > (highestGwScore?.score ?? 0)) {
      highestGwScore = { teamName: m.team_a?.team_name ?? 'Unknown', score: scoreA, gameweek: m.gameweek };
    }
    if (scoreB > (highestGwScore?.score ?? 0)) {
      highestGwScore = { teamName: m.team_b?.team_name ?? 'Unknown', score: scoreB, gameweek: m.gameweek };
    }
  }

  // ── Group archive by season ────────────────────────────────────────────────
  const seasons = new Map<string, any[]>();
  for (const row of archive as any[]) {
    if (!seasons.has(row.season)) seasons.set(row.season, []);
    seasons.get(row.season)!.push(row);
  }

  // ── Build cup winners map per season ──────────────────────────────────────
  const cupWinnersMap = new Map<string, Record<string, string>>();
  for (const row of cupWinnerData) {
    if (!cupWinnersMap.has(row.season)) cupWinnersMap.set(row.season, {});
    cupWinnersMap.get(row.season)![row.tournament_name] = row.winner_name;
  }

  const seasonsList = Array.from(seasons.entries()).map(([season, rows]) => ({
    season,
    standings: rows,
    cupWinners: cupWinnersMap.get(season) ?? {},
  }));

  return (
    <HistoryClient
      leagueName={league.name}
      currentSeason={league.current_season ?? league.season}
      seasons={seasonsList}
      highestGwScore={highestGwScore}
    />
  );
}
