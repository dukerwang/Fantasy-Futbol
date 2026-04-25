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
    isCurrentFplGwFinished?: boolean;
    featured?: boolean;
    recordA?: TeamRecord | null;
    recordB?: TeamRecord | null;
}

export default function LiveMatchupCard({
    matchup,
    myTeamId,
    currentFplGw,
    isCurrentFplGwFinished,
    featured = false,
    recordA,
    recordB,
}: Props) {
    const [liveScore, setLiveScore] = useState({
        score_a: matchup.score_a,
        score_b: matchup.score_b,
    });

    let effectiveStatus = matchup.status;
    if (currentFplGw > matchup.gameweek || (currentFplGw === matchup.gameweek && isCurrentFplGwFinished)) {
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

    // Ensure state stays synced when the matchup prop changes (e.g. user toggles gameweeks)
    useEffect(() => {
        setLiveScore({ score_a: matchup.score_a, score_b: matchup.score_b });
    }, [matchup.score_a, matchup.score_b]);

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
        poll(); // fetch immediately on mount
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
                
                {/* Team A — left column */}
                <div className={styles.heroTeamCol}>
                    <span className={styles.heroTeamName}>
                        {teamAName}
                    </span>
                    {recordA && (
                        <span className={styles.heroRecord}>
                            {recordA.W}W · {recordA.D}D · {recordA.L}L
                        </span>
                    )}
                </div>

                {/* Center — scores + badge */}
                <div className={styles.heroCenter}>
                    <span className={styles.heroSectionLabelCentered}>
                        Your Fixture · GW {matchup.gameweek}
                    </span>
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
                        <span className={`${styles.heroWinBadge} ${isDraw ? styles.draw : ''} ${(!isDraw && myTeamSide && ((myTeamSide === 'a' && bWins) || (myTeamSide === 'b' && aWins))) ? styles.loss : ''}`}>
                            {isDraw 
                                ? 'Draw' 
                                : myTeamSide 
                                    ? ((myTeamSide === 'a' && aWins) || (myTeamSide === 'b' && bWins) ? 'You Won' : 'You Lost')
                                    : (aWins ? `${teamAName} Win` : `${teamBName} Win`)}
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

                {/* Team B — right column (same depth as team A so names align) */}
                <div className={`${styles.heroTeamCol} ${styles.right}`}>
                    <span className={styles.heroTeamName}>
                        {teamBName}
                    </span>
                    {recordB && (
                        <span className={styles.heroRecord}>
                            {recordB.W}W · {recordB.D}D · {recordB.L}L
                        </span>
                    )}
                </div>
            </Link>
        );
    }

    // ── Grid card (compact) variant ────────────────────────────────────────────
    // Each team gets its own W/L/D badge on the outer edge
    const getTeamBadge = (wins: boolean, loses: boolean): { cls: string; text: string } => {
        if (isLive) return { cls: styles.sideBadgeLive, text: '▶' };
        if (!isCompleted) return { cls: styles.sideBadgeEmpty, text: '' };
        if (isDraw) return { cls: styles.sideBadgeDraw, text: 'D' };
        if (wins) return { cls: styles.sideBadgeWin, text: 'W' };
        if (loses) return { cls: styles.sideBadgeLoss, text: 'L' };
        return { cls: styles.sideBadgeEmpty, text: '' };
    };

    const badgeA = getTeamBadge(aWins, bWins);
    const badgeB = getTeamBadge(bWins, aWins);

    const statusText = isLive ? 'Live' : isCompleted ? 'Final' : 'Sched';

    return (
        <Link href={href} className={styles.matchupCardLink}>
            <div className={styles.matchupCard}>
                {/* Team A half: [badge] [name ... score] */}
                <div className={styles.cardHalf}>
                    <div className={`${styles.sideBadge} ${badgeA.cls}`}>
                        {isLive && badgeA.text === '▶' ? <span className={styles.livePulse} /> : badgeA.text}
                    </div>
                    <div className={styles.halfInfo}>
                        <span className={[styles.halfName, myTeamSide === 'a' ? styles.myTeam : ''].filter(Boolean).join(' ')}>
                            {teamAName}
                        </span>
                        <span className={`${styles.halfScore} ${bWins ? styles.loser : ''}`}>
                            {scoreA.toFixed(1)}
                        </span>
                    </div>
                </div>

                {/* Center */}
                <div className={styles.cardMiddle}>{statusText}</div>

                {/* Team B half: [score ... name] [badge] — NO row-reverse so score stays left of name */}
                <div className={`${styles.cardHalf} ${styles.cardHalfRight}`}>
                    <div className={styles.halfInfo}>
                        <span className={`${styles.halfScore} ${aWins ? styles.loser : ''}`}>
                            {scoreB.toFixed(1)}
                        </span>
                        <span className={[styles.halfName, styles.right, myTeamSide === 'b' ? styles.myTeam : ''].filter(Boolean).join(' ')}>
                            {teamBName}
                        </span>
                    </div>
                    <div className={`${styles.sideBadge} ${badgeB.cls}`}>
                        {isLive && badgeB.text === '▶' ? <span className={styles.livePulse} /> : badgeB.text}
                    </div>
                </div>
            </div>
        </Link>
    );
}
