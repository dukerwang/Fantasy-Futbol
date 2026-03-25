import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Matchup, MatchupLineup, Player } from '@/types';
import ReadonlyPitch from '@/components/ReadonlyPitch';
import styles from './matchup-detail.module.css';

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ leagueId: string; matchupId: string }>;
}

export default async function MatchupDetailPage({ params }: Props) {
    const { leagueId, matchupId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    // Validate league membership
    const { data: league } = await admin
        .from('leagues')
        .select('id, name, commissioner_id')
        .eq('id', leagueId)
        .single();

    if (!league) notFound();

    const { data: member } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member && league.commissioner_id !== user.id) redirect('/dashboard');

    // Fetch matchup with team details
    const { data: matchupData } = await admin
        .from('matchups')
        .select(`
            *,
            team_a:teams!matchups_team_a_id_fkey(id, team_name),
            team_b:teams!matchups_team_b_id_fkey(id, team_name)
        `)
        .eq('id', matchupId)
        .eq('league_id', leagueId)
        .single();

    if (!matchupData) notFound();

    const matchup = matchupData as Matchup & {
        team_a: { id: string; team_name: string } | null;
        team_b: { id: string; team_name: string } | null;
    };

    const lineupA = matchup.lineup_a as MatchupLineup | null;
    const lineupB = matchup.lineup_b as MatchupLineup | null;

    // Collect all unique player IDs from both lineups
    const playerIds = new Set<string>();
    lineupA?.starters.forEach((s) => playerIds.add(s.player_id));
    lineupA?.bench.forEach((b) => playerIds.add(b.player_id));
    lineupB?.starters.forEach((s) => playerIds.add(s.player_id));
    lineupB?.bench.forEach((b) => playerIds.add(b.player_id));

    // Fetch player data for all referenced players
    let playerMap: Record<string, Partial<Player>> = {};
    if (playerIds.size > 0) {
        const { data: players } = await admin
            .from('players')
            .select('id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at')
            .in('id', Array.from(playerIds));

        for (const p of players ?? []) {
            playerMap[p.id] = p as Partial<Player>;
        }
    }

    // Fetch per-player GW fantasy points for score overlay on pitch cards
    let detailMap: Record<string, { points: number, stats?: any }> = {};
    if (playerIds.size > 0 && matchupData.gameweek) {
        const { data: statsRows, error: statsError } = await admin
            .from('player_stats')
            .select('player_id, fantasy_points, stats')
            .eq('gameweek', matchupData.gameweek)
            .in('player_id', Array.from(playerIds));

        for (const s of statsRows ?? []) {
            const currentPoints = detailMap[s.player_id]?.points ?? 0;
            detailMap[s.player_id] = {
                points: currentPoints + Number(s.fantasy_points),
                stats: s.stats || detailMap[s.player_id]?.stats || {}
            };
        }
    }


    // Score comparison helpers
    const isCompleted = matchup.status === 'completed';
    const isLive = matchup.status === 'live';
    const aWins = isCompleted && matchup.score_a > matchup.score_b;
    const bWins = isCompleted && matchup.score_b > matchup.score_a;

    const teamAName = matchup.team_a?.team_name ?? 'Team A';
    const teamBName = matchup.team_b?.team_name ?? 'Team B';

    return (
        <div className={styles.container}>
            {/* Back link */}
            <Link href={`/league/${leagueId}/matchups`} className={styles.backLink}>
                ← Matchups
            </Link>

            {/* Score banner */}
            <div className={`${styles.scoreBanner} ${isLive ? styles.live : ''} ${isCompleted ? styles.completed : ''}`}>
                {/* Team A */}
                <div className={styles.bannerTeam}>
                    <span className={styles.bannerTeamName}>{teamAName}</span>
                    <span className={`${styles.bannerScore} ${aWins ? styles.winner : ''}`}>
                        {(lineupA?.starters.reduce((acc, s) => acc + (detailMap[s.player_id]?.points ?? 0), 0) ?? matchup.score_a).toFixed(1)}
                    </span>
                </div>

                {/* Middle */}
                <div className={styles.bannerMiddle}>
                    <span className={`${styles.statusBadge} ${isLive ? styles.live : ''} ${isCompleted ? styles.completed : ''}`}>
                        {matchup.status.toUpperCase()}
                    </span>
                    <span className={styles.gwLabel}>GW {matchup.gameweek}</span>
                    <span className={styles.vsText}>VS</span>
                </div>

                {/* Team B */}
                <div className={`${styles.bannerTeam} ${styles.right}`}>
                    <span className={styles.bannerTeamName}>{teamBName}</span>
                    <span className={`${styles.bannerScore} ${bWins ? styles.winner : ''}`}>
                        {(lineupB?.starters.reduce((acc, s) => acc + (detailMap[s.player_id]?.points ?? 0), 0) ?? matchup.score_b).toFixed(1)}
                    </span>
                </div>
            </div>

            {/* Side-by-side pitch views */}
            <div className={styles.pitchGrid}>
                {/* Team A pitch */}
                <div className={styles.pitchPanel}>
                    {lineupA ? (
                        <ReadonlyPitch
                            lineup={lineupA}
                            playerMap={playerMap}
                            detailMap={detailMap}
                            teamName={teamAName}
                        />
                    ) : (
                        <div className={styles.noLineup}>
                            <span>{teamAName} has not submitted a lineup yet.</span>
                        </div>
                    )}
                </div>

                {/* Team B pitch */}
                <div className={styles.pitchPanel}>
                    {lineupB ? (
                        <ReadonlyPitch
                            lineup={lineupB}
                            playerMap={playerMap}
                            detailMap={detailMap}
                            teamName={teamBName}
                        />
                    ) : (
                        <div className={styles.noLineup}>
                            <span>{teamBName} has not submitted a lineup yet.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
