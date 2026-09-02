'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Matchup } from '@/types';
import LiveMatchupCard from './LiveMatchupCard';
import GameweekSelector from './GameweekSelector';
import RoundLead from './RoundLead';
import { isDrawMargin, DRAW_THRESHOLD } from '@/lib/scoring/drawBand';
import styles from './matchups.module.css';

interface TeamRecord {
    W: number;
    L: number;
    D: number;
}

interface MatchupsClientProps {
    allMatchups: Matchup[];
    initialGw: number;
    gameweeks: number[];
    leagueId: string;
    formattedSeason: string;
    myTeamId?: string;
    currentFplGw: number;
    isCurrentFplGwFinished: boolean;
    finalisedGws: number[];
}

function computeRecord(
    teamId: string,
    rows: Array<{ team_a_id: string; team_b_id: string; score_a: number; score_b: number }>,
): TeamRecord {
    let W = 0, L = 0, D = 0;
    for (const m of rows) {
        const isA = m.team_a_id === teamId;
        const isB = m.team_b_id === teamId;
        if (!isA && !isB) continue;
        const myScore = isA ? m.score_a : m.score_b;
        const oppScore = isA ? m.score_b : m.score_a;
        if (isDrawMargin(myScore, oppScore)) D++;
        else if (myScore > oppScore) W++;
        else L++;
    }
    return { W, L, D };
}

function generateGameweekSummaryText(
    highestThisGw: { score: number; team: string },
    closestMatch: any,
    gw: number
): string {
    if (highestThisGw.score === 0) {
        return `Gameweek ${gw} is scheduled. Managers are finalizing lineups, and scouts are preparing player ratings.`;
    }

    const highestScoreStr = `**${highestThisGw.team}** set the pace in Gameweek ${gw} with a massive ${highestThisGw.score.toFixed(2)} points.`;

    let closestStr = '';
    if (closestMatch) {
        const teamA = closestMatch.team_a?.team_name ? `**${closestMatch.team_a.team_name}**` : 'Team A';
        const teamB = closestMatch.team_b?.team_name ? `**${closestMatch.team_b.team_name}**` : 'Team B';
        const diff = Math.abs(closestMatch.score_a - closestMatch.score_b);
        if (diff <= DRAW_THRESHOLD) {
            closestStr = ` Meanwhile, ${teamA} and ${teamB} played out a nail-biting ${diff.toFixed(2)}-point stalemate.`;
        } else {
            closestStr = ` Meanwhile, the closest duel of the week saw ${teamA} edge out ${teamB} by just ${diff.toFixed(2)} points.`;
        }
    }

    return `${highestScoreStr}${closestStr}`;
}

export default function MatchupsClient({
    allMatchups,
    initialGw,
    gameweeks,
    leagueId,
    formattedSeason,
    myTeamId,
    currentFplGw,
    isCurrentFplGwFinished,
    finalisedGws,
}: MatchupsClientProps) {
    const [selectedGw, setSelectedGw] = useState<number>(initialGw);

    // Synchronize browser URL history without full server SSR navigations
    const handleSelectGw = useCallback((newGw: number) => {
        setSelectedGw(newGw);
        const newUrl = `/league/${leagueId}/matchups?gw=${newGw}`;
        window.history.pushState(null, '', newUrl);
    }, [leagueId]);

    // Listen for browser Back/Forward navigation
    useEffect(() => {
        const onPopState = () => {
            const urlParams = new URLSearchParams(window.location.search);
            const gwParam = urlParams.get('gw');
            if (gwParam) {
                const parsed = parseInt(gwParam, 10);
                if (parsed && gameweeks.includes(parsed)) {
                    setSelectedGw(parsed);
                }
            }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [gameweeks]);

    const finalisedSet = useMemo(() => new Set(finalisedGws), [finalisedGws]);
    const isTargetGwFinalised = finalisedSet.has(selectedGw);

    // Current gameweek's fixtures
    const gwMatchups = useMemo(() => {
        return allMatchups.filter((m) => m.gameweek === selectedGw);
    }, [allMatchups, selectedGw]);

    // Featured matchup separation
    const myMatchup = useMemo(() => {
        return gwMatchups.find(
            (m) => m.team_a?.id === myTeamId || m.team_b?.id === myTeamId,
        ) ?? null;
    }, [gwMatchups, myTeamId]);

    const otherMatchups = useMemo(() => {
        return gwMatchups.filter((m) => m.id !== myMatchup?.id);
    }, [gwMatchups, myMatchup]);

    // All completed matchups for season records + season high
    // SAFETY: Supabase query includes team_a and team_b foreign key joins
    const completedRows = useMemo(() => {
        return allMatchups
            .filter((m) => m.status === 'completed')
            .map((m) => ({
                team_a_id: m.team_a_id,
                team_b_id: m.team_b_id,
                score_a: m.score_a,
                score_b: m.score_b,
                team_a: m.team_a ? { team_name: m.team_a.team_name } : null,
                team_b: m.team_b ? { team_name: m.team_b.team_name } : null,
            }));
    }, [allMatchups]);

    // Season records for featured matchup teams
    const myTeamAId = myMatchup?.team_a?.id;
    const myTeamBId = myMatchup?.team_b?.id;
    const recordA = useMemo(() => (myTeamAId ? computeRecord(myTeamAId, completedRows) : null), [myTeamAId, completedRows]);
    const recordB = useMemo(() => (myTeamBId ? computeRecord(myTeamBId, completedRows) : null), [myTeamBId, completedRows]);

    // Season high across all completed matches
    const seasonHigh = useMemo(() => {
        let best = { score: 0, team: '—' };
        for (const m of completedRows) {
            if (m.score_a > best.score) best = { score: m.score_a, team: m.team_a?.team_name ?? '—' };
            if (m.score_b > best.score) best = { score: m.score_b, team: m.team_b?.team_name ?? '—' };
        }
        return best;
    }, [completedRows]);

    // GW at a Glance — computed from selected GW matchups
    const { highestThisGw, closestMatch, summaryText } = useMemo(() => {
        const gwScores = gwMatchups.flatMap((m) => [
            { score: m.score_a, team: m.team_a?.team_name ?? '—' },
            { score: m.score_b, team: m.team_b?.team_name ?? '—' },
        ]);
        const highest = gwScores.reduce(
            (best, s) => (s.score > best.score ? s : best),
            { score: 0, team: '—' },
        );
        const closest = gwMatchups.length > 0
            ? [...gwMatchups].sort((a, b) => Math.abs(a.score_a - a.score_b) - Math.abs(b.score_a - b.score_b))[0]
            : null;
        const summary = generateGameweekSummaryText(highest, closest, selectedGw);
        return { highestThisGw: highest, closestMatch: closest, summaryText: summary };
    }, [gwMatchups, selectedGw]);

    return (
        <div className={`${styles.page} g-page`}>
            {/* The masthead names the round; the panel below IS the round. */}
            <header className={styles.masthead}>
                <div className={styles.mastheadTitles}>
                    <span className={`g-label ${styles.kicker}`}>Premier League Season {formattedSeason}</span>
                    <h1 className={styles.title}>Gameweek {selectedGw}</h1>
                </div>
                {gameweeks.length > 0 && (
                    <GameweekSelector
                        targetGw={selectedGw}
                        gameweeks={gameweeks}
                        leagueId={leagueId}
                        onSelectGw={handleSelectGw}
                    />
                )}
            </header>

            {gwMatchups.length === 0 ? (
                <div className={styles.emptyPanel}>
                    No matchups scheduled for Gameweek {selectedGw}.
                </div>
            ) : (
                <>
                    {/* The round's standfirst */}
                    <RoundLead summaryText={summaryText} />

                    <section className={styles.round}>
                        {myMatchup && (
                            <LiveMatchupCard
                                matchup={myMatchup}
                                myTeamId={myTeamId}
                                currentFplGw={currentFplGw}
                                isCurrentFplGwFinished={isCurrentFplGwFinished}
                                finalised={isTargetGwFinalised}
                                featured={true}
                                recordA={recordA}
                                recordB={recordB}
                            />
                        )}

                        {otherMatchups.length > 0 && (
                            <div className={styles.fixtures}>
                                <h2 className={styles.fixturesHead}>
                                    {myMatchup ? 'Other Fixtures' : `Gameweek ${selectedGw} Fixtures`}
                                </h2>
                                {otherMatchups.map((m) => (
                                    <LiveMatchupCard
                                        key={m.id}
                                        matchup={m}
                                        myTeamId={myTeamId}
                                        currentFplGw={currentFplGw}
                                        isCurrentFplGwFinished={isCurrentFplGwFinished}
                                        finalised={isTargetGwFinalised}
                                    />
                                ))}
                            </div>
                        )}

                        {highestThisGw.score > 0 && (
                            <div className={styles.glance}>
                                <div className={styles.glanceStat}>
                                    <span className="g-label-quiet">Highest score</span>
                                    <span className={styles.glanceValue}>{highestThisGw.score.toFixed(2)}</span>
                                    <span className={styles.glanceSub}>{highestThisGw.team}</span>
                                </div>
                                <div className={styles.glanceStat}>
                                    <span className="g-label-quiet">Closest match</span>
                                    <span className={styles.glanceValue}>
                                        {closestMatch
                                            ? Math.abs(closestMatch.score_a - closestMatch.score_b).toFixed(2)
                                            : '—'}
                                    </span>
                                    <span className={styles.glanceSub}>
                                        {closestMatch
                                            ? `${closestMatch.team_a?.team_name ?? 'Team A'} v ${closestMatch.team_b?.team_name ?? 'Team B'}`
                                            : '—'}
                                    </span>
                                </div>
                                <div className={styles.glanceStat}>
                                    <span className="g-label-quiet">Season high</span>
                                    <span className={styles.glanceValue}>
                                        {seasonHigh.score > 0 ? seasonHigh.score.toFixed(2) : '—'}
                                    </span>
                                    <span className={styles.glanceSub}>{seasonHigh.team}</span>
                                </div>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
