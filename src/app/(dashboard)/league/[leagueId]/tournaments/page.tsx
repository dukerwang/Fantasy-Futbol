import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Tournament, TournamentRound, TournamentMatchup } from '@/types';
import styles from './tournaments.module.css';

interface Props {
    params: Promise<{ leagueId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TournamentsPage({ params, searchParams }: Props) {
    const { leagueId } = await params;
    const resolvedSearchParams = await searchParams;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    const { data: league } = await admin
        .from('leagues')
        .select('id, name')
        .eq('id', leagueId)
        .single();

    if (!league) notFound();

    // Validate membership
    const { data: member } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member) redirect('/dashboard');

    // Fetch all tournaments for this league
    const { data: tournamentsData } = await admin
        .from('tournaments')
        .select('*')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false });

    const tournaments = (tournamentsData ?? []) as Tournament[];
    
    if (tournaments.length === 0) {
        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <span className={styles.pageSupertitle}>CUPS</span>
                    <h2 className={styles.title}>Cup Competitions</h2>
                </header>
                <div className={styles.emptyCard}>
                    No tournaments have been created yet.
                </div>
            </div>
        );
    }

    // Determine active tournament from search params or default to first
    const selectedCupId = resolvedSearchParams.cup ? String(resolvedSearchParams.cup) : null;
    let activeTournament = tournaments.find(t => t.id === selectedCupId);
    
    if (!activeTournament) {
        // Fallback to first active, or first overall
        activeTournament = tournaments.find(t => t.status === 'active') || tournaments[0];
    }

    // Fetch rounds with matchups for the active tournament
    const { data: roundsData } = await admin
        .from('tournament_rounds')
        .select('*')
        .eq('tournament_id', activeTournament.id)
        .order('round_number', { ascending: true });

    const rounds = (roundsData ?? []) as TournamentRound[];

    const roundIds = rounds.map(r => r.id);
    let matchups: TournamentMatchup[] = [];
    
    if (roundIds.length > 0) {
        const { data: matchupsData } = await admin
            .from('tournament_matchups')
            .select(`
                *,
                team_a:teams!tournament_matchups_team_a_id_fkey(id, team_name),
                team_b:teams!tournament_matchups_team_b_id_fkey(id, team_name),
                winner:teams!tournament_matchups_winner_id_fkey(id, team_name)
            `)
            .in('round_id', roundIds)
            .order('bracket_position', { ascending: true });

        matchups = (matchupsData ?? []) as TournamentMatchup[];
    }

    const roundsWithMatchups = rounds.map(round => ({
        ...round,
        matchups: matchups.filter(m => m.round_id === round.id),
    }));

    // Previous Winner logic (mocked if none, but we can look at completed tournaments)
    // Find champion of active tournament if completed
    let championName = "TBD";
    let championStatus = "In Progress";
    if (activeTournament.status === 'completed' && roundsWithMatchups.length > 0) {
        const finalRound = roundsWithMatchups[roundsWithMatchups.length - 1];
        const finalMatchup = finalRound?.matchups[0];
        if (finalMatchup?.winner) {
            championName = finalMatchup.winner.team_name;
            championStatus = `Champion`;
        }
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <span className={styles.pageSupertitle}>CUPS</span>
                <div className={styles.headerContent}>
                    <h2 className={styles.title}>Cup Competitions</h2>
                    <div className={styles.tabContainer}>
                        {tournaments.map(t => {
                            const isActive = t.id === activeTournament.id;
                            return (
                                <Link 
                                    key={t.id} 
                                    href={`/league/${leagueId}/tournaments?cup=${t.id}`}
                                    className={`${styles.tab} ${isActive ? styles.tabActive : styles.tabInactive}`}
                                >
                                    {t.name}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </header>

            {/* Info Bar */}
            <div className={styles.infoBar}>
                <div className={styles.infoLeft}>
                    <span className={styles.infoText}>
                        {activeTournament.name} <span className={styles.divider}>·</span> 10 TEAMS <span className={styles.divider}>·</span> FINAL: MATCHWEEK 29
                    </span>
                </div>
                {activeTournament.status === 'active' && (
                    <div className={styles.infoRight}>
                        <span className={styles.livePulseIndicator}></span>
                        <span className={styles.infoLiveText}>IN PROGRESS</span>
                    </div>
                )}
            </div>

            {/* Bracket Section */}
            <section className={styles.bracketSection}>
                {roundsWithMatchups.length === 0 ? (
                    <div className={styles.emptyBracket}>Bracket not yet generated.</div>
                ) : (
                    <div className={styles.bracket}>
                        {roundsWithMatchups.map((round, roundIdx) => {
                            // Assign exact Matchweek string based on Design System
                            let mwLabel = `MW ${round.start_gameweek}`;
                            if (round.name.toLowerCase().includes('16')) mwLabel = 'MW 9';
                            else if (round.name.toLowerCase().includes('quarter')) mwLabel = 'MW 16';
                            else if (round.name.toLowerCase().includes('semi')) mwLabel = 'MW 21 + MW 24';
                            else if (round.name.toLowerCase().includes('final')) mwLabel = 'MW 29';

                            return (
                                <div key={round.id} className={styles.round}>
                                    <div className={styles.roundHeader}>
                                        <h4 className={styles.roundName}>{round.name}</h4>
                                        <p className={styles.roundGw}>{mwLabel}</p>
                                    </div>

                                    <div className={styles.matchups}>
                                        {round.matchups.map((matchup) => (
                                            <div key={matchup.id} className={styles.matchupWrapper}>
                                                <BracketMatchup
                                                    matchup={matchup}
                                                    isTwoLeg={round.is_two_leg}
                                                    myTeamId={member.id}
                                                />
                                                {/* Connector Line */}
                                                {roundIdx < roundsWithMatchups.length - 1 && (
                                                    <div className={`${styles.connectorLine} ${
                                                        (matchup.team_a_id === member.id || matchup.team_b_id === member.id) 
                                                            && matchup.winner_id === member.id // If my team advanced
                                                            ? styles.connectorLineActive : ''
                                                    }`} />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Cup Overview Widgets */}
            <div className={styles.overviewGrid}>
                {/* Cup Schedule */}
                <div className={styles.overviewCard}>
                    <h4 className={styles.overviewTitle}>Cup Schedule</h4>
                    <table className={styles.scheduleTable}>
                        <tbody>
                            <tr className={styles.scheduleRow}>
                                <td className={styles.scheduleLabel}>Round 16</td>
                                <td className={styles.scheduleValue}>Matchweek 9</td>
                            </tr>
                            <tr className={styles.scheduleRow}>
                                <td className={styles.scheduleLabel}>Quarterfinals</td>
                                <td className={styles.scheduleValue}>Matchweek 16</td>
                            </tr>
                            <tr className={styles.scheduleRow}>
                                <td className={styles.scheduleLabel}>Semifinals</td>
                                <td className={styles.scheduleValue}>MW 21 & 24</td>
                            </tr>
                            <tr className={styles.scheduleRow}>
                                <td className={styles.scheduleLabel}>Final</td>
                                <td className={`${styles.scheduleValue} ${styles.textGreen}`}>Matchweek 29</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Previous Winner */}
                <div className={styles.overviewCard}>
                    <h4 className={styles.overviewTitle}>Previous Winner</h4>
                    <div className={styles.winnerContent}>
                        <p className={styles.winnerName}>{championName}</p>
                        <p className={styles.winnerSubtitle}>{championStatus}</p>
                        <div className={styles.winnerDescDivider}></div>
                        <p className={styles.winnerDesc}>
                            {championName === 'TBD' 
                                ? "The tournament is currently awaiting its champion."
                                : "Secured the title with an impressive performance."}
                        </p>
                    </div>
                </div>
            </div>
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

    const activeClass = matchup.status === 'active' ? styles.matchupActive : '';
    
    // Check if my team is in the matchup and highlight it structurally
    const highlightMyTeam = isMyMatchup ? styles.myMatchupActive : '';

    return (
        <div className={`${styles.matchup} ${activeClass} ${highlightMyTeam}`}>
            <div className={`${styles.teamRow} ${matchup.winner_id === matchup.team_a_id && matchup.winner_id ? styles.winnerRow : ''} ${matchup.team_a_id === myTeamId ? styles.myTeamRow : ''}`}>
                <span className={styles.teamLabel}>
                    {isTBD ? 'TBD' : teamAName}
                </span>
                {!isTBD && !isBye && (
                    <div className={styles.scoreGroup}>
                        {matchup.status === 'active' && <span className={styles.matchupLive}>Live</span>}
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
            
            {/* If leg 1 is pending for a two-legged match without score */}
            {isTwoLeg && isTBD && (
               <div className={styles.leg1Pending}>
                   <p className={styles.leg1PendingText}>Leg 1 Pending</p>
               </div>
            )}
            
            {/* Aggregate sub-label */}
            {isTwoLeg && !isTBD && !isBye && matchup.status === 'completed' && (
               <div className={styles.aggregateLabelBox}>
                   <p className={styles.aggregateLabel}>Aggregate Final</p>
               </div>
            )}
        </div>
    );
}
