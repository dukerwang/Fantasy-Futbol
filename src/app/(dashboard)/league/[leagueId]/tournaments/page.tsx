import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Tournament, TournamentRound, TournamentMatchup } from '@/types';
import { getSeeding } from '@/lib/tournaments/engine';
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
        .select('id, name, created_at')
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

    let tournaments = (tournamentsData ?? []) as Tournament[];
    
    // Rename any fallback old data and sort securely
    tournaments = tournaments.map(t => {
        if (t.type === 'primary_cup') t.name = 'Champions Cup';
        if (t.type === 'consolation_cup') t.name = 'Consolation Cup';
        return t;
    });

    const typeOrder: Record<string, number> = {
        'secondary_cup': 1,
        'primary_cup': 2,
        'consolation_cup': 3
    };
    tournaments.sort((a, b) => (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99));
    
    if (tournaments.length === 0) {
        return (
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.headerContent}>
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

    // ── Current FPL State ──
    let currentFplGw = 1;
    let isFinished = false;
    try {
        const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 3600 } });
        if (fplRes.ok) {
            const fplData = await fplRes.json();
            const currentEvent = (fplData.events as any[]).find((e: any) => e.is_current);
            if (currentEvent) {
                currentFplGw = currentEvent.id;
                isFinished = currentEvent.finished;
            } else {
                // Fallback to deadline check if no event is marked current
                const now = new Date();
                for (const ev of fplData.events as any[]) {
                    if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
                        currentFplGw = Math.max(currentFplGw, ev.id);
                    }
                }
                const fallbackEvent = (fplData.events as any[]).find((e: any) => e.id === currentFplGw);
                isFinished = fallbackEvent?.finished ?? false;
            }
        }
    } catch { /* FPL unreachable */ }

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

        return { ...round, pairs, slotsCount };
    });

    const lastRound = rounds[rounds.length - 1];
    const isPastFinal = lastRound && (currentFplGw > lastRound.end_gameweek || (currentFplGw === lastRound.end_gameweek && isFinished));
    
    // Find live round based on range
    const liveRound = rounds.find(r => currentFplGw >= r.start_gameweek && currentFplGw <= r.end_gameweek);
    const displayStatus = (activeTournament.status === 'completed' || isPastFinal) ? 'completed' : 'active';
    
    // A round is fundamentally "Live" if the current GW is within its range 
    // AND it's not the case that we're on the final GW of that round and it's finished.
    const isLive = liveRound && (currentFplGw < liveRound.end_gameweek || !isFinished);

    const seedMap = new Map<string, number>();
    if (roundsWithPairs.length > 0) {
        const firstRound = roundsWithPairs[0];
        const bracketSize = firstRound.slotsCount * 2;
        const seeding = getSeeding(bracketSize);
        
        const firstRoundMatchups = matchups.filter(m => m.round_id === firstRound.id).sort((a,b) => a.bracket_position - b.bracket_position);
        
        firstRoundMatchups.forEach((m) => {
            if (m.team_a_id) seedMap.set(m.team_a_id, seeding[m.bracket_position * 2]);
            if (m.team_b_id) seedMap.set(m.team_b_id, seeding[m.bracket_position * 2 + 1]);
        });
    }

    return (
        <div className={styles.container}>
            <div className={styles.headerSection}>
                <header className={styles.header}>
                    <div className={styles.headerContent}>
                        <div className={styles.headerLeft}>
                            <span className={styles.pageSupertitle}>CUPS</span>
                            <h2 className={styles.title}>Cup Competitions</h2>
                        </div>
                    </div>
                </header>

                <div className={styles.tabContainer}>
                    {tournaments.map(t => {
                        const isActive = t.id === activeTournament?.id;
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

                <div className={styles.infoBar}>
                    <div className={styles.infoLeft}>
                        <span className={styles.infoText}>
                            {activeTournament?.name} 
                            <span className={styles.divider}>·</span>
                            {league.name}
                            <span className={styles.divider}>·</span>
                            FINAL: MATCHWEEK {rounds[rounds.length - 1]?.end_gameweek || 'TBD'}
                        </span>
                    </div>
                    {displayStatus === 'active' && isLive && (
                        <div className={styles.infoRight}>
                            <span className={styles.livePulseIndicator}></span>
                            <span className={styles.infoLiveText}>IN PROGRESS</span>
                        </div>
                    )}
                    {displayStatus === 'completed' && (
                        <div className={styles.infoRight}>
                            <span className={styles.infoLiveText} style={{ color: 'var(--color-text-muted)' }}>FINISHED</span>
                        </div>
                    )}
                    {displayStatus === 'active' && !isLive && !isPastFinal && (
                        <div className={styles.infoRight}>
                            <span className={styles.infoLiveText} style={{ color: 'var(--color-text-muted)' }}>SCHEDULED</span>
                        </div>
                    )}
                </div>
            </div>

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
                                        <p className={styles.roundName}>
                                            {round.name}
                                            {currentFplGw >= round.start_gameweek && currentFplGw <= round.end_gameweek && (currentFplGw < round.end_gameweek || !isFinished) && (
                                                <span className={styles.roundLiveBadge}>Live</span>
                                            )}
                                        </p>
                                        <p className={styles.roundGw}>MW {round.start_gameweek}{round.end_gameweek !== round.start_gameweek && ` - ${round.end_gameweek}`}</p>
                                    </div>

                                    <div className={styles.matchupSlots}>
                                        {round.pairs.map((pair, pairIdx) => {
                                            const m0 = pair[0];
                                            const m1 = pair[1];
                                            
                                            const myPathTop = m0 && m0.winner_id === member.id && (m0.team_a_id === member.id || m0.team_b_id === member.id);
                                            const myPathBottom = m1 && m1.winner_id === member.id && (m1.team_a_id === member.id || m1.team_b_id === member.id);

                                            return (
                                                <div key={pairIdx} className={styles.slotPair}>
                                                    <div className={styles.slot}>
                                                        {roundIdx > 0 && <div className={`${styles.connectorIn} ${hasIncomingActiveLeft(m0, member.id) ? styles.connectorActive : ''}`} />}
                                                        {m0 ? (
                                                            <div className={styles.matchupWrapper}>
                                                                <BracketMatchup 
                                                                    matchup={m0} 
                                                                    isTwoLeg={round.is_two_leg} 
                                                                    myTeamId={member.id} 
                                                                    teamASeed={seedMap.get(m0.team_a_id ?? '')} 
                                                                    teamBSeed={seedMap.get(m0.team_b_id ?? '')} 
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className={styles.matchupPlaceholder} />
                                                        )}
                                                    </div>

                                                    {!isFinal && (
                                                        <div className={styles.slot}>
                                                            {roundIdx > 0 && <div className={`${styles.connectorIn} ${hasIncomingActiveLeft(m1, member.id) ? styles.connectorActive : ''}`} />}
                                                            {m1 ? (
                                                                <div className={styles.matchupWrapper}>
                                                                    <BracketMatchup 
                                                                        matchup={m1} 
                                                                        isTwoLeg={round.is_two_leg} 
                                                                        myTeamId={member.id} 
                                                                        teamASeed={seedMap.get(m1.team_a_id ?? '')} 
                                                                        teamBSeed={seedMap.get(m1.team_b_id ?? '')} 
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <div className={styles.matchupPlaceholder} />
                                                            )}
                                                        </div>
                                                    )}

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
        </div>
    );
}

function hasIncomingActiveLeft(m: TournamentMatchup | null, myId: string) {
    if (!m) return false;
    return (m.team_a_id === myId || m.team_b_id === myId);
}

function BracketMatchup({
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
