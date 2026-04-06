import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Matchup, MatchupLineup, Player } from '@/types';
import MatchupPitch from '@/components/MatchupPitch';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
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

    const playerIds = new Set<string>();
    lineupA?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupA?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));
    lineupB?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupB?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));

    let playerMap: Record<string, Partial<Player>> = {};
    if (playerIds.size > 0) {
        const [{ data: playersData }, { data: rankings }] = await Promise.all([
            admin.from('players').select(FULL_PLAYER_SELECT).in('id', Array.from(playerIds)) as any,
            admin.from('player_rankings').select('*').in('player_id', Array.from(playerIds)),
        ]);
        const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
        for (const p of (playersData ?? []) as any[]) {
            const ranks = rankMap.get(p.id);
            playerMap[p.id] = { ...p, overall_rank: ranks?.overall_rank, position_ranks: ranks?.position_ranks } as Partial<Player>;
        }
    }

    const { loadReferenceStats } = await import('@/lib/scoring/matchups');
    const { calculateMatchRating } = await import('@/lib/scoring/engine');
    const refStats = await loadReferenceStats(admin, '2025-26');

    let detailMap: Record<string, { points: number; stats?: any }> = {};
    if (playerIds.size > 0 && matchupData.gameweek) {
        const { data: statsRows } = await admin
            .from('player_stats')
            .select('player_id, fantasy_points, stats')
            .eq('gameweek', matchupData.gameweek)
            .in('player_id', Array.from(playerIds));

        for (const s of statsRows ?? []) {
            detailMap[s.player_id] = { points: Number(s.fantasy_points), stats: s.stats || {} };
        }

        const applySlotWeights = (lineup: MatchupLineup | null) => {
            lineup?.starters.forEach((s) => {
                const detail = detailMap[s.player_id];
                if (detail?.stats && detail.stats.minutes_played > 0) {
                    const { fantasyPoints } = calculateMatchRating(detail.stats, s.slot, refStats as any);
                    detailMap[s.player_id].points = fantasyPoints;
                }
            });
        };
        applySlotWeights(lineupA);
        applySlotWeights(lineupB);
    }

    const isCompleted = matchup.status === 'completed';
    const isLive      = matchup.status === 'live';
    const scoreA      = matchup.score_a;
    const scoreB      = matchup.score_b;
    const isDraw      = isCompleted && Math.abs(scoreA - scoreB) <= 10;
    const aWins       = isCompleted && !isDraw && scoreA > scoreB;
    const bWins       = isCompleted && !isDraw && scoreB > scoreA;
    const teamAName   = matchup.team_a?.team_name ?? 'Team A';
    const teamBName   = matchup.team_b?.team_name ?? 'Team B';

    return (
        <div className={styles.container}>
            <Link href={`/league/${leagueId}/matchups`} className={styles.backLink}>
                ← Matchups
            </Link>

            {/* Score banner */}
            <div className={styles.matchHeader}>
                <h1 className={styles.matchTitle}>{teamAName} vs {teamBName}</h1>

                <div className={styles.scoreRow}>
                    <span className={`${styles.bannerScore} ${bWins ? styles.loser : ''}`}>
                        {scoreA.toFixed(1)}
                    </span>
                    <span className={styles.scoreDash}>–</span>
                    <span className={`${styles.bannerScore} ${aWins ? styles.loser : ''}`}>
                        {scoreB.toFixed(1)}
                    </span>

                    {isCompleted && (
                        <span className={`${styles.winBadge} ${isDraw ? styles.draw : ''}`}>
                            {aWins ? `${teamAName} Win` : bWins ? `${teamBName} Win` : 'Draw'}
                        </span>
                    )}
                    {isLive && (
                        <span className={`${styles.winBadge} ${styles.live}`}>Live</span>
                    )}
                    {!isCompleted && !isLive && (
                        <span className={`${styles.winBadge} ${styles.draw}`}>Scheduled</span>
                    )}
                </div>

                <div className={styles.gwMeta}>
                    <span className={styles.gwLabel}>Game Week {matchup.gameweek}</span>
                </div>
            </div>

            {/* Unified pitch + bench + breakdown */}
            <MatchupPitch
                lineupA={lineupA}
                lineupB={lineupB}
                playerMap={playerMap}
                detailMap={detailMap}
                teamAName={teamAName}
                teamBName={teamBName}
            />
        </div>
    );
}
