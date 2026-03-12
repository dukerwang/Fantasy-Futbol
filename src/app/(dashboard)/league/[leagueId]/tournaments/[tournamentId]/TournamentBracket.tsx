'use client';

import type { TournamentRound, TournamentMatchup } from '@/types';
import styles from './bracket.module.css';

interface Props {
    rounds: (TournamentRound & { matchups: TournamentMatchup[] })[];
    myTeamId?: string;
}

export default function TournamentBracket({ rounds, myTeamId }: Props) {
    if (rounds.length === 0) {
        return <div className={styles.emptyBracket}>Bracket not yet generated.</div>;
    }

    return (
        <div className={styles.bracket}>
            {rounds.map((round, roundIdx) => (
                <div key={round.id} className={styles.round}>
                    <div className={styles.roundHeader}>
                        <span className={styles.roundName}>{round.name}</span>
                        <span className={styles.roundGw}>
                            GW {round.start_gameweek}
                            {round.is_two_leg ? `–${round.end_gameweek}` : ''}
                        </span>
                    </div>

                    <div className={styles.matchups}>
                        {round.matchups.map((matchup) => (
                            <BracketMatchup
                                key={matchup.id}
                                matchup={matchup}
                                isTwoLeg={round.is_two_leg}
                                myTeamId={myTeamId}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function BracketMatchup({
    matchup,
    isTwoLeg,
    myTeamId,
}: {
    matchup: TournamentMatchup;
    isTwoLeg: boolean;
    myTeamId?: string;
}) {
    const teamAName = matchup.team_a?.team_name ?? 'BYE';
    const teamBName = matchup.team_b?.team_name ?? 'BYE';
    const isBye = !matchup.team_a_id || !matchup.team_b_id;
    const isTBD = !matchup.team_a_id && !matchup.team_b_id;

    const totalA = Number(matchup.team_a_score_leg1) + Number(matchup.team_a_score_leg2);
    const totalB = Number(matchup.team_b_score_leg1) + Number(matchup.team_b_score_leg2);

    const isMyMatchup =
        matchup.team_a_id === myTeamId || matchup.team_b_id === myTeamId;

    const statusClass =
        matchup.status === 'active' ? styles.matchupActive
            : matchup.status === 'completed' ? styles.matchupCompleted
                : '';

    return (
        <div className={`${styles.matchup} ${statusClass} ${isMyMatchup ? styles.myMatchup : ''}`}>
            {matchup.status === 'active' && (
                <div className={styles.matchupLive}>
                    <span className={styles.livePulse} />
                    LIVE
                </div>
            )}

            <div className={`${styles.teamRow} ${matchup.winner_id === matchup.team_a_id && matchup.winner_id ? styles.winnerRow : ''} ${matchup.team_a_id === myTeamId ? styles.myTeamRow : ''}`}>
                <span className={styles.teamLabel}>
                    {isTBD ? 'TBD' : teamAName}
                </span>
                {!isTBD && !isBye && (
                    <div className={styles.scoreGroup}>
                        {isTwoLeg && (
                            <>
                                <span className={styles.legScore}>{Number(matchup.team_a_score_leg1).toFixed(1)}</span>
                                <span className={styles.legScore}>{Number(matchup.team_a_score_leg2).toFixed(1)}</span>
                                <span className={styles.legDivider} />
                            </>
                        )}
                        <span className={styles.totalScore}>
                            {isTwoLeg ? totalA.toFixed(1) : Number(matchup.team_a_score_leg1).toFixed(1)}
                        </span>
                    </div>
                )}
            </div>

            <div className={`${styles.teamRow} ${matchup.winner_id === matchup.team_b_id && matchup.winner_id ? styles.winnerRow : ''} ${matchup.team_b_id === myTeamId ? styles.myTeamRow : ''}`}>
                <span className={styles.teamLabel}>
                    {isTBD ? 'TBD' : teamBName}
                </span>
                {!isTBD && !isBye && (
                    <div className={styles.scoreGroup}>
                        {isTwoLeg && (
                            <>
                                <span className={styles.legScore}>{Number(matchup.team_b_score_leg1).toFixed(1)}</span>
                                <span className={styles.legScore}>{Number(matchup.team_b_score_leg2).toFixed(1)}</span>
                                <span className={styles.legDivider} />
                            </>
                        )}
                        <span className={styles.totalScore}>
                            {isTwoLeg ? totalB.toFixed(1) : Number(matchup.team_b_score_leg1).toFixed(1)}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
