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
  const [archiveResult, allMatchupsResult, tournsResult] = await Promise.all([
    // Season standings archive
    admin
      .from('season_standings_archive')
      .select(
        `season, final_rank, total_points, archived_at,
         team:teams!team_id(id, team_name, user:users!user_id(username))`
      )
      .eq('league_id', leagueId)
      .order('season', { ascending: false })
      .order('final_rank', { ascending: true }),

    // All completed matchups for all-time records
    admin
      .from('matchups')
      .select('score_a, score_b, gameweek, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
      .eq('league_id', leagueId)
      .eq('status', 'completed'),

    // Completed tournaments for cup winners
    admin
      .from('tournaments')
      .select('id, name, season, status')
      .eq('league_id', leagueId)
      .eq('status', 'completed'),
  ]);

  const archive = archiveResult.data ?? [];
  const allMatchups = allMatchupsResult.data ?? [];
  const tournaments = tournsResult.data ?? [];

  // ── Resolve cup winners by walking tournament → rounds → final matchup ────
  const cupWinnerData: Array<{ tournament_name: string; season: string; winner_name: string }> = [];

  for (const t of tournaments as any[]) {
    // Find the final round (highest round_number)
    const { data: finalRound } = await admin
      .from('tournament_rounds')
      .select('id')
      .eq('tournament_id', t.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single();

    if (!finalRound) continue;

    // Find completed matchup in that round with a winner
    const { data: matchups } = await admin
      .from('tournament_matchups')
      .select('winner_id, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
      .eq('round_id', finalRound.id)
      .eq('status', 'completed')
      .not('winner_id', 'is', null)
      .limit(1);

    const finalMatchup = matchups?.[0];
    if (!finalMatchup?.winner_id) continue;

    const teamA = finalMatchup.team_a as any;
    const teamB = finalMatchup.team_b as any;
    const winnerName =
      finalMatchup.winner_id === teamA?.id ? (teamA?.team_name ?? 'Unknown') :
      finalMatchup.winner_id === teamB?.id ? (teamB?.team_name ?? 'Unknown') :
      'Unknown';

    cupWinnerData.push({
      tournament_name: t.name,
      season: t.season ?? league.current_season ?? league.season,
      winner_name: winnerName,
    });
  }

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
