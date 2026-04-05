'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Matchup } from '@/types';
import styles from './matchups.module.css';

interface TeamRecord {
    W: number;
    L: number;
    D: number;
}

interface Props {
    matchup: Matchup;
    myTeamId?: string;
    currentFplGw: number;
    aHasCup?: boolean;
    bHasCup?: boolean;
    featured?: boolean;
    recordA?: TeamRecord | null;
    recordB?: TeamRecord | null;
}

export default function LiveMatchupCard({
    matchup,
    myTeamId,
    currentFplGw,
    aHasCup,
    bHasCup,
    featured = false,
    recordA,
    recordB,
}: Props) {
    const [liveScore, setLiveScore] = useState({
        score_a: matchup.score_a,
        score_b: matchup.score_b,
    });

    let effectiveStatus = matchup.status;
    if (currentFplGw > matchup.gameweek) {
        effectiveStatus = 'completed';
    } else if (currentFplGw === matchup.gameweek && matchup.status === 'scheduled') {
        effectiveStatus = 'live';
    }

    const isLive = effectiveStatus === 'live';
    const isCompleted = effectiveStatus === 'completed';

    const teamAName = (matchup as any).team_a?.team_name ?? 'TBD';
    const teamBName = (matchup as any).team_b?.team_name ?? 'TBD';
    const teamAId = (matchup as any).team_a?.id;
    const teamBId = (matchup as any).team_b?.id;

    const myTeamSide =
        myTeamId === teamAId ? 'a' : myTeamId === teamBId ? 'b' : null;

    useEffect(() => {
        if (!isLive) return;
        const poll = async () => {
            try {
                const res = await fetch(`/api/leagues/${matchup.league_id}/matchups/${matchup.id}/score`);
                if (res.ok) {
                    const data = await res.json();
                    setLiveScore({ score_a: data.score_a, score_b: data.score_b });
                }
            } catch { /* silent */ }
        };
        const interval = setInterval(poll, 60_000);
        return () => clearInterval(interval);
    }, [isLive, matchup.id, matchup.league_id]);

    const scoreA = liveScore.score_a;
    const scoreB = liveScore.score_b;

    // Draw rule: abs(score_a - score_b) <= 10 → draw
    const isDraw = isCompleted && Math.abs(scoreA - scoreB) <= 10;
    const aWins = isCompleted && !isDraw && scoreA > scoreB;
    const bWins = isCompleted && !isDraw && scoreB > scoreA;

    const href = `/league/${matchup.league_id}/matchups/${matchup.id}`;

    // ── Hero (featured matchup) variant ────────────────────────────────────────
    if (featured) {
        return (
            <Link href={href} className={styles.heroCard}>
                <span className={styles.heroSectionLabel}>
                    Your Fixture · GW {matchup.gameweek}
                </span>

                {/* Team A — left column */}
                <div className={styles.heroTeamCol}>
                    <span className={styles.heroTeamName}>
                        {teamAName}
                        {aHasCup && <span title="Also in Cup this week" style={{ marginLeft: '0.4rem' }}>🏆</span>}
                    </span>
                    {recordA && (
                        <span className={styles.heroRecord}>
                            {recordA.W}W · {recordA.D}D · {recordA.L}L
                        </span>
                    )}
                </div>

                {/* Center — scores + badge */}
                <div className={styles.heroCenter}>
                    <div className={styles.heroScoreRow}>
                        <span className={`${styles.heroScore} ${bWins ? styles.loser : ''}`}>
                            {scoreA.toFixed(1)}
                        </span>
                        <span className={styles.heroDash}>–</span>
                        <span className={`${styles.heroScore} ${aWins ? styles.loser : ''}`}>
                            {scoreB.toFixed(1)}
                        </span>
                    </div>

                    {isCompleted && (
                        <span className={`${styles.heroWinBadge} ${isDraw ? styles.draw : ''}`}>
                            {aWins ? `${teamAName} Win` : bWins ? `${teamBName} Win` : 'Draw'}
                        </span>
                    )}
                    {isLive && (
                        <span className={`${styles.heroWinBadge} ${styles.live}`}>
                            <span className={styles.livePulse} /> Live
                        </span>
                    )}
                    {effectiveStatus === 'scheduled' && (
                        <span className={`${styles.heroWinBadge} ${styles.draw}`}>Scheduled</span>
                    )}
                </div>

                {/* Team B — right column */}
                <div className={`${styles.heroTeamCol} ${styles.right}`}>
                    <span className={styles.heroTeamName}>
                        {bHasCup && <span title="Also in Cup this week" style={{ marginRight: '0.4rem' }}>🏆</span>}
                        {teamBName}
                    </span>
                    {recordB && (
                        <span className={styles.heroRecord}>
                            {recordB.W}W · {recordB.D}D · {recordB.L}L
                        </span>
                    )}
                    <span className={styles.heroViewLink}>View Matchup →</span>
                </div>
            </Link>
        );
    }

    // ── Grid card (compact) variant ────────────────────────────────────────────
    const getBadgeClass = () => {
        if (isLive) return styles.cardBadgeLive;
        if (!isCompleted) return styles.cardBadgeScheduled;
        if (isDraw) return styles.cardBadgeDraw;
        if (!myTeamSide) return styles.cardBadgeFinal;
        const myWins = (myTeamSide === 'a' && aWins) || (myTeamSide === 'b' && bWins);
        return myWins ? styles.cardBadgeWin : styles.cardBadgeLoss;
    };

    const getBadgeText = () => {
        if (isLive) return 'Live';
        if (!isCompleted) return 'SCH';
        if (isDraw) return 'D';
        if (!myTeamSide) return 'FT';
        const myWins = (myTeamSide === 'a' && aWins) || (myTeamSide === 'b' && bWins);
        return myWins ? 'W' : 'L';
    };

    return (
        <Link href={href} className={styles.matchupCardLink}>
            <div className={[styles.matchupCard, myTeamSide ? styles.myMatchup : ''].filter(Boolean).join(' ')}>
                {/* Team A */}
                <div className={styles.team}>
                    <span className={[styles.teamName, myTeamSide === 'a' ? styles.myTeam : ''].filter(Boolean).join(' ')}>
                        {teamAName}
                        {aHasCup && ' 🏆'}
                    </span>
                </div>

                {/* Center: score · badge · score */}
                <div className={styles.cardCenter}>
                    <span className={`${styles.cardScore} ${bWins ? styles.loser : ''}`}>
                        {scoreA.toFixed(1)}
                    </span>
                    <span className={`${styles.cardBadge} ${getBadgeClass()}`}>
                        {isLive && <span className={styles.livePulse} />}
                        {getBadgeText()}
                    </span>
                    <span className={`${styles.cardScore} ${aWins ? styles.loser : ''}`}>
                        {scoreB.toFixed(1)}
                    </span>
                </div>

                {/* Team B */}
                <div className={`${styles.team} ${styles.right}`}>
                    <span className={[styles.teamName, myTeamSide === 'b' ? styles.myTeam : ''].filter(Boolean).join(' ')}>
                        {bHasCup && '🏆 '}
                        {teamBName}
                    </span>
                </div>
            </div>
        </Link>
    );
}
