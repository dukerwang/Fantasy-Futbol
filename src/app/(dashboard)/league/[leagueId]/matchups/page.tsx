import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import type { Matchup } from '@/types';
import LiveMatchupCard from './LiveMatchupCard';
import GameweekSelector from './GameweekSelector';
import styles from './matchups.module.css';

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ leagueId: string }>;
    searchParams: Promise<{ gw?: string }>;
}

interface TeamRecord { W: number; L: number; D: number; }

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
        if (Math.abs(myScore - oppScore) <= 10) D++;
        else if (myScore > oppScore) W++;
        else L++;
    }
    return { W, L, D };
}

export default async function MatchupsPage({ params, searchParams }: Props) {
    const { leagueId } = await params;
    const { gw } = await searchParams;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    const { data: league } = await admin
        .from('leagues')
        .select('id, name, commissioner_id, status')
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

    // Current FPL gameweek
    let currentFplGw = 1;
    let isCurrentFplGwFinished = false;
    try {
        const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 300 } });
        if (fplRes.ok) {
            const fplData = await fplRes.json();
            const now = new Date();
            for (const ev of fplData.events as any[]) {
                if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
                    currentFplGw = Math.max(currentFplGw, ev.id);
                }
            }
            const currentEvent = (fplData.events as any[]).find((e: any) => e.id === currentFplGw);
            isCurrentFplGwFinished = currentEvent?.finished ?? false;
        }
    } catch { /* ignore */ }

    // Gameweeks this league actually has fixtures for (must run before matchup query)
    const { data: allGws } = await admin
        .from('matchups')
        .select('gameweek')
        .eq('league_id', leagueId)
        .order('gameweek', { ascending: true });

    let gameweeks = Array.from(new Set((allGws ?? []).map((row) => row.gameweek))).sort((a, b) => a - b);

    // Self-healing: if the draft was auto-completed via SQL cron, matchups might not exist yet
    if (gameweeks.length === 0 && league.status === 'active') {
        const { insertMatchups } = await import('@/lib/schedule/insertMatchups');
        await insertMatchups(admin, leagueId).catch(console.error);
        
        // Re-fetch gameweeks after generation
        const { data: refreshedGws } = await admin
            .from('matchups')
            .select('gameweek')
            .eq('league_id', leagueId)
            .order('gameweek', { ascending: true });
        gameweeks = Array.from(new Set((refreshedGws ?? []).map((row) => row.gameweek))).sort((a, b) => a - b);
    }

    let targetGw = parseInt(gw ?? '0', 10);
    
    // Robust fallback if no gw in URL or FPL API fails
    if (!targetGw) {
        if (currentFplGw > 1) {
            targetGw = currentFplGw;
        } else if (gameweeks.length > 0) {
            // Find the first active gameweek
            const { data: activeMatchups } = await admin
                .from('matchups')
                .select('gameweek')
                .eq('league_id', leagueId)
                .in('status', ['live', 'scheduled'])
                .order('gameweek', { ascending: true })
                .limit(1);
            
            if (activeMatchups && activeMatchups.length > 0) {
                targetGw = activeMatchups[0].gameweek;
            } else {
                targetGw = gameweeks[gameweeks.length - 1]; // Fallback to last week of season
            }
        } else {
            targetGw = 1;
        }
    }

    // If URL/default GW has no league matchups, snap to a real GW (fixes empty page +
    // invalid <select value> showing the wrong GW in the selector).
    if (gameweeks.length > 0 && !gameweeks.includes(targetGw)) {
        const snapped = gameweeks.find((g) => g >= targetGw) ?? gameweeks[gameweeks.length - 1]!;
        redirect(`/league/${leagueId}/matchups?gw=${snapped}`);
    }

    // Fetch matchups for target GW (include user_id for featured matchup detection)
    const { data: matchupsData } = await admin
        .from('matchups')
        .select(`
            *,
            team_a:teams!matchups_team_a_id_fkey(id, team_name, user_id),
            team_b:teams!matchups_team_b_id_fkey(id, team_name, user_id)
        `)
        .eq('league_id', leagueId)
        .eq('gameweek', targetGw)
        .order('id', { ascending: true });

    const matchups = (matchupsData ?? []) as Matchup[];

    // Cup teams this gameweek
    const { data: leagueTourneys } = await admin.from('tournaments').select('id').eq('league_id', leagueId);
    const tourneyIds = new Set((leagueTourneys || []).map((t) => t.id));
    const { data: validRounds } = await admin
        .from('tournament_rounds')
        .select('id, tournament_id')
        .lte('start_gameweek', targetGw)
        .gte('end_gameweek', targetGw);
    const roundIds = (validRounds || []).filter((r) => tourneyIds.has(r.tournament_id)).map((r) => r.id);
    const cupTeamIds = new Set<string>();
    if (roundIds.length > 0) {
        const { data: cupMatchups } = await admin
            .from('tournament_matchups')
            .select('team_a_id, team_b_id')
            .in('round_id', roundIds);
        cupMatchups?.forEach((cm) => {
            if (cm.team_a_id) cupTeamIds.add(cm.team_a_id);
            if (cm.team_b_id) cupTeamIds.add(cm.team_b_id);
        });
    }

    // User's team
    const { data: myTeam } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    // Featured matchup separation
    const myMatchup = matchups.find(
        (m) => (m as any).team_a?.id === myTeam?.id || (m as any).team_b?.id === myTeam?.id,
    ) ?? null;
    const otherMatchups = matchups.filter((m) => m.id !== myMatchup?.id);

    // All completed matchups for season records + season high
    const { data: allCompleted } = await admin
        .from('matchups')
        .select(`
            team_a_id, team_b_id, score_a, score_b,
            team_a:teams!matchups_team_a_id_fkey(team_name),
            team_b:teams!matchups_team_b_id_fkey(team_name)
        `)
        .eq('league_id', leagueId)
        .eq('status', 'completed');

    const completedRows = (allCompleted ?? []) as unknown as Array<{
        team_a_id: string; team_b_id: string;
        score_a: number; score_b: number;
        team_a: { team_name: string } | null;
        team_b: { team_name: string } | null;
    }>;

    // Season records for featured matchup teams
    const myTeamAId = (myMatchup as any)?.team_a?.id as string | undefined;
    const myTeamBId = (myMatchup as any)?.team_b?.id as string | undefined;
    const recordA = myTeamAId ? computeRecord(myTeamAId, completedRows) : null;
    const recordB = myTeamBId ? computeRecord(myTeamBId, completedRows) : null;

    // Season high
    let seasonHigh = { score: 0, team: '—' };
    for (const m of completedRows) {
        if (m.score_a > seasonHigh.score) seasonHigh = { score: m.score_a, team: m.team_a?.team_name ?? '—' };
        if (m.score_b > seasonHigh.score) seasonHigh = { score: m.score_b, team: m.team_b?.team_name ?? '—' };
    }

    // GW at a Glance — computed from current GW matchups
    const gwScores = matchups.flatMap((m) => [
        { score: m.score_a, team: (m as any).team_a?.team_name ?? '—' },
        { score: m.score_b, team: (m as any).team_b?.team_name ?? '—' },
    ]);
    const highestThisGw = gwScores.reduce(
        (best, s) => (s.score > best.score ? s : best),
        { score: 0, team: '—' },
    );
    const closestMatch = matchups.length > 0
        ? [...matchups].sort((a, b) => Math.abs(a.score_a - a.score_b) - Math.abs(b.score_a - b.score_b))[0]
        : null;

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.pageHeader}>
                <div className={styles.pageTitleGroup}>
                    <span className={styles.pageSupertitle}>Premier League Season 25/26</span>
                    <h1 className={styles.pageTitle}>Gameweek {targetGw}</h1>
                </div>
                {gameweeks.length > 0 && (
                    <GameweekSelector targetGw={targetGw} gameweeks={gameweeks} leagueId={leagueId} />
                )}
            </header>

            {matchups.length === 0 ? (
                <div className={styles.emptyCard}>No matchups scheduled for Gameweek {targetGw}.</div>
            ) : (
                <>
                    {/* Featured hero matchup */}
                    {myMatchup && (
                        <LiveMatchupCard
                            matchup={myMatchup}
                            myTeamId={myTeam?.id}
                            currentFplGw={currentFplGw}
                            isCurrentFplGwFinished={isCurrentFplGwFinished}
                            featured={true}
                            recordA={recordA}
                            recordB={recordB}
                        />
                    )}

                    {/* Other matchups grid */}
                    {otherMatchups.length > 0 && (
                        <>
                            <div className={styles.sectionLabel}>All GW {targetGw} Results</div>
                            <div className={styles.matchupGrid}>
                                {otherMatchups.map((m) => (
                                    <LiveMatchupCard
                                        key={m.id}
                                        matchup={m}
                                        myTeamId={myTeam?.id}
                                        currentFplGw={currentFplGw}
                                        isCurrentFplGwFinished={isCurrentFplGwFinished}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* GW at a Glance */}
                    {highestThisGw.score > 0 && (
                        <div className={styles.glanceStrip}>
                            <div className={styles.glanceStat}>
                                <span className={styles.glanceLabel}>Highest Score</span>
                                <span className={styles.glanceValue}>{highestThisGw.score.toFixed(1)}</span>
                                <span className={styles.glanceSub}>{highestThisGw.team}</span>
                            </div>
                            <div className={styles.glanceStat}>
                                <span className={styles.glanceLabel}>Closest Match</span>
                                <span className={styles.glanceValue}>
                                    {closestMatch
                                        ? `${Math.abs(closestMatch.score_a - closestMatch.score_b).toFixed(1)} pts`
                                        : '—'}
                                </span>
                                <span className={styles.glanceSub}>
                                    {closestMatch
                                        ? `${(closestMatch as any).team_a?.team_name} vs ${(closestMatch as any).team_b?.team_name}`
                                        : '—'}
                                </span>
                            </div>
                            <div className={styles.glanceStat}>
                                <span className={styles.glanceLabel}>Season High</span>
                                <span className={styles.glanceValue}>
                                    {seasonHigh.score > 0 ? seasonHigh.score.toFixed(1) : '—'}
                                </span>
                                <span className={styles.glanceSub}>{seasonHigh.team}</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
