import type { TournamentMatchup } from '@/types';
import styles from '@/app/(dashboard)/league/[leagueId]/tournaments/tournaments.module.css';

export function BracketMatchup({
    matchup,
    isTwoLeg,
    myTeamId,
    teamASeed,
    teamBSeed,
}: {
    matchup: TournamentMatchup;
    isTwoLeg: boolean;
    myTeamId?: string;
    teamASeed?: number;
    teamBSeed?: number;
}) {
    const teamAName = matchup.team_a?.team_name ?? 'BYE';
    const teamBName = matchup.team_b?.team_name ?? 'BYE';
    const isTBD = !matchup.team_a_id && !matchup.team_b_id;
    const isBye = !matchup.team_a_id || !matchup.team_b_id;

    const totalA = Number(matchup.team_a_score_leg1) + Number(matchup.team_a_score_leg2);
    const totalB = Number(matchup.team_b_score_leg1) + Number(matchup.team_b_score_leg2);

    const isMyMatchup = matchup.team_a_id === myTeamId || matchup.team_b_id === myTeamId;
    const highlightMyTeam = isMyMatchup ? styles.myMatchupActive : '';

    return (
        <div className={`${styles.matchup} ${highlightMyTeam}`}>
            <div className={`${styles.teamRow} ${matchup.winner_id === matchup.team_a_id && matchup.winner_id ? styles.winnerRow : ''} ${matchup.team_a_id === myTeamId ? styles.myTeamRow : ''}`}>
                <span className={styles.teamLabel}>
                    {isTBD ? 'TBD' : (
                        <>
                            {teamASeed && <span className={styles.teamSeed}>{teamASeed}</span>}
                            {teamAName}
                        </>
                    )}
                </span>
                {!isTBD && (
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
                    {isTBD ? 'TBD' : (
                        <>
                            {teamBSeed && <span className={styles.teamSeed}>{teamBSeed}</span>}
                            {teamBName}
                        </>
                    )}
                </span>
                {!isTBD && !isBye && (
                    <div className={styles.scoreGroup}>
                        {matchup.status === 'active' && <span className={styles.matchupLive}>Live</span>}
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
            {isTwoLeg && isTBD && <div className={styles.leg1Pending}><p className={styles.leg1PendingText}>Leg 1 Pending</p></div>}
            {isTwoLeg && !isTBD && !isBye && matchup.status === 'completed' && <div className={styles.aggregateLabelBox}><p className={styles.aggregateLabel}>Aggregate Final</p></div>}
        </div>
    );
}
