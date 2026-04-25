import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Matchup, MatchupLineup, Player } from '@/types';
import MatchupPitch from '@/components/MatchupPitch';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
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

    const lineupA = normalizeMatchupLineup(matchup.lineup_a as MatchupLineup | null);
    const lineupB = normalizeMatchupLineup(matchup.lineup_b as MatchupLineup | null);

    const playerIds = new Set<string>();
    lineupA?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupA?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));
    lineupB?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupB?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));

    const playerMap: Record<string, Partial<Player>> = {};
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

    // Load pre-computed fantasy_points from player_stats.
    // We do NOT re-run calculateMatchRating here — the stored stats JSON often has
    // zeroed BPS/ICT fields when the sync ran before FPL finalized bonus points,
    // which would produce wrong recalculated scores. The fantasy_points column is
    // computed at sync time with the full data and is the authoritative value.
    const detailMap: Record<string, { points: number; stats?: any }> = {};
    if (playerIds.size > 0 && matchupData.gameweek) {
        const { data: statsRows } = await admin
            .from('player_stats')
            .select('player_id, fantasy_points, stats')
            .eq('gameweek', matchupData.gameweek)
            .in('player_id', Array.from(playerIds));

        for (const s of statsRows ?? []) {
            detailMap[s.player_id] = { points: Number(s.fantasy_points), stats: s.stats || {} };
        }
    }

    let computedScoreA = 0;
    lineupA?.starters.forEach(s => { computedScoreA += detailMap[s.player_id]?.points || 0; });
    let computedScoreB = 0;
    lineupB?.starters.forEach(s => { computedScoreB += detailMap[s.player_id]?.points || 0; });

    const isCompleted = matchup.status === 'completed';
    const isLive      = matchup.status === 'live';
    const scoreA      = isCompleted ? matchup.score_a : computedScoreA;
    const scoreB      = isCompleted ? matchup.score_b : computedScoreB;
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
