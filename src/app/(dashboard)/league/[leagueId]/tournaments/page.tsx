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

    const { data: member } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member) redirect('/dashboard');

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
                    <div className={styles.headerTop}>
                        <div className={styles.headerLeft}>
                            <span className={styles.pageSupertitle}>CUPS</span>
                            <h2 className={styles.title}>Cup Competitions</h2>
                        </div>
                    </div>
                </header>
                <div className={styles.emptyCard}>
                    No tournaments have been created yet.
                </div>
            </div>
        );
    }

    const selectedCupId = resolvedSearchParams.cup ? String(resolvedSearchParams.cup) : null;
    let activeTournament = tournaments.find(t => t.id === selectedCupId);
    
    if (!activeTournament) {
        activeTournament = tournaments.find(t => t.status === 'active') || tournaments[0];
    }
    const isLeagueCup = (activeTournament as any)?.type === 'league_cup' || activeTournament?.name.toLowerCase().includes('league');

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

    // Binary Tree padding logic
    const roundsWithPairs = rounds.map((round, roundIdx) => {
        const remainingRounds = rounds.length - roundIdx;
        const slotsCount = Math.pow(2, remainingRounds - 1);
        
        const slots = Array.from({ length: slotsCount }, (_, i) => 
            matchups.find(m => m.round_id === round.id && m.bracket_position === i) || null
        );

        const pairs = [];
        if (slotsCount === 1) {
            pairs.push([slots[0], null]);
        } else {
            for (let i = 0; i < slots.length; i += 2) {
                pairs.push([slots[i], slots[i+1]]);
            }
        }

        // Determine correct Matchweek logic based on tournament type
        let mwLabel = `MW ${round.start_gameweek}`;
        const formatName = round.name.toLowerCase();
        
        if (isLeagueCup) {
            if (formatName.includes('16')) mwLabel = 'MW 9';
            else if (formatName.includes('quarter')) mwLabel = 'MW 16';
            else if (formatName.includes('semi')) mwLabel = 'MW 21 + MW 24';
            else if (formatName.includes('final')) mwLabel = 'MW 31';
        } else {
            // Champions/Europa logic
            if (formatName.includes('quarter')) mwLabel = 'MW 32 + MW 33';
            else if (formatName.includes('semi')) mwLabel = 'MW 34 + MW 35';
            else if (formatName.includes('final')) mwLabel = 'MW 38';
        }

        return { ...round, pairs, slotsCount, mwLabel };
    });

    // Determine champion
    let championName = "TBD";
    let championStatus = "In Progress";
    if (activeTournament.status === 'completed' && roundsWithPairs.length > 0) {
        const finalRound = roundsWithPairs[roundsWithPairs.length - 1];
        const finalMatchup = finalRound?.pairs[0]?.[0];
        if (finalMatchup?.winner) {
            championName = finalMatchup.winner.team_name;
            championStatus = `Champion`;
        }
    }

    return (
        <div className={styles.container}>
            {/* Unified Header matching exact layout sequence */}
            <div className={styles.headerSection}>
                <header className={styles.header}>
                    <div className={styles.headerTop}>
                        <div className={styles.headerLeft}>
                            <span className={styles.pageSupertitle}>CUPS</span>
                            <h2 className={styles.title}>Cup Competitions</h2>
                        </div>
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

                {/* Separator line above info bar */}
                <div className={styles.headerDivider} />

                <div className={styles.infoBar}>
                    <div className={styles.infoLeft}>
                        <span className={styles.infoText}>
                            {activeTournament.name} <span className={styles.divider}>·</span> {(activeTournament as any).team_count ?? 10} TEAMS <span className={styles.divider}>·</span> FINAL: {isLeagueCup ? 'MATCHWEEK 31' : 'MATCHWEEK 38'}
                        </span>
                    </div>
                    {activeTournament.status === 'active' && (
                        <div className={styles.infoRight}>
                            <span className={styles.livePulseIndicator}></span>
                            <span className={styles.infoLiveText}>IN PROGRESS</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Bracket Section */}
            <section className={styles.bracketSection}>
                {roundsWithPairs.length === 0 ? (
                    <div className={styles.emptyBracket}>Bracket not yet generated.</div>
                ) : (
                    <div className={styles.bracket}>
                        {roundsWithPairs.map((round, roundIdx) => {
                            const isFinal = round.slotsCount === 1;

                            return (
                                <div key={round.id} className={styles.roundColumn}>
                                    <div className={styles.roundHeader}>
                                        <h4 className={styles.roundName}>{round.name}</h4>
                                        <p className={styles.roundGw}>{round.mwLabel}</p>
                                    </div>

                                    <div className={styles.matchupSlots}>
                                        {round.pairs.map((pair, pairIdx) => {
                                            const m0 = pair[0];
                                            const m1 = pair[1];
                                            
                                            // Active highlight logic for elbows
                                            const myPathTop = m0 && m0.winner_id === member.id && (m0.team_a_id === member.id || m0.team_b_id === member.id);
                                            const myPathBottom = m1 && m1.winner_id === member.id && (m1.team_a_id === member.id || m1.team_b_id === member.id);

                                            return (
                                                <div key={pairIdx} className={styles.slotPair}>
                                                    {/* Top Slot */}
                                                    <div className={styles.slot}>
                                                        {roundIdx > 0 && <div className={`${styles.connectorIn} ${hasIncomingActiveLeft(m0, member.id) ? styles.connectorActive : ''}`} />}
                                                        {m0 ? (
                                                            <div className={styles.matchupWrapper}>
                                                                <BracketMatchup matchup={m0} isTwoLeg={round.is_two_leg} myTeamId={member.id} />
                                                            </div>
                                                        ) : (
                                                            <div className={styles.matchupPlaceholder} />
                                                        )}
                                                    </div>

                                                    {/* Bottom Slot */}
                                                    {!isFinal && (
                                                        <div className={styles.slot}>
                                                            {roundIdx > 0 && <div className={`${styles.connectorIn} ${hasIncomingActiveLeft(m1, member.id) ? styles.connectorActive : ''}`} />}
                                                            {m1 ? (
                                                                <div className={styles.matchupWrapper}>
                                                                    <BracketMatchup matchup={m1} isTwoLeg={round.is_two_leg} myTeamId={member.id} />
                                                                </div>
                                                            ) : (
                                                                <div className={styles.matchupPlaceholder} />
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Output Connectors (Elbows) */}
                                                    {!isFinal && (
                                                        <>
                                                            <div className={`${styles.elbowTop} ${myPathTop ? styles.elbowActive : ''}`} />
                                                            <div className={`${styles.elbowBottom} ${myPathBottom ? styles.elbowActive : ''}`} />
                                                        </>
                                                    )}
                                                </div>
                                            )
                                        })}
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
                    {isLeagueCup ? (
                        <table className={styles.scheduleTable}>
                            <tbody>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Round 16</td><td className={styles.scheduleValue}>Matchweek 9</td></tr>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Quarterfinals</td><td className={styles.scheduleValue}>Matchweek 16</td></tr>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Semifinals</td><td className={styles.scheduleValue}>MW 21 & 24</td></tr>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Final</td><td className={`${styles.scheduleValue} ${styles.textGreen}`}>Matchweek 31</td></tr>
                            </tbody>
                        </table>
                    ) : (
                        <table className={styles.scheduleTable}>
                            <tbody>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Quarterfinals</td><td className={styles.scheduleValue}>Matchweek 32 & 33</td></tr>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Semifinals</td><td className={styles.scheduleValue}>Matchweek 34 & 35</td></tr>
                                <tr className={styles.scheduleRow}><td className={styles.scheduleLabel}>Final</td><td className={`${styles.scheduleValue} ${styles.textGreen}`}>Matchweek 38</td></tr>
                            </tbody>
                        </table>
                    )}
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

function hasIncomingActiveLeft(m: TournamentMatchup | null, myId: string) {
    if (!m) return false;
    // We highlight left connector if we just look geometrically, 
    // but the left connector is just the input to THIS matchup.
    // If the user is in this matchup, the incoming line is technically their advancing path.
    return (m.team_a_id === myId || m.team_b_id === myId);
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

    const isMyMatchup = matchup.team_a_id === myTeamId || matchup.team_b_id === myTeamId;
    const activeClass = matchup.status === 'active' ? styles.matchupActive : '';
    const highlightMyTeam = isMyMatchup ? styles.myMatchupActive : '';

    return (
        <div className={`${styles.matchup} ${activeClass} ${highlightMyTeam}`}>
            <div className={`${styles.teamRow} ${matchup.winner_id === matchup.team_a_id && matchup.winner_id ? styles.winnerRow : ''} ${matchup.team_a_id === myTeamId ? styles.myTeamRow : ''}`}>
                <span className={styles.teamLabel}>{isTBD ? 'TBD' : teamAName}</span>
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
                <span className={styles.teamLabel}>{isTBD ? 'TBD' : teamBName}</span>
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
