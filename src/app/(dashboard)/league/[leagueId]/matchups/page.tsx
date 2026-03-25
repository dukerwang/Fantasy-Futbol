import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import type { Matchup } from '@/types';
import LiveMatchupCard from './LiveMatchupCard';
import GameweekSelector from './GameweekSelector';
import styles from './matchups.module.css';

interface Props {
    params: Promise<{ leagueId: string }>;
    searchParams: Promise<{ gw?: string }>;
}

export default async function MatchupsPage({ params, searchParams }: Props) {
    const { leagueId } = await params;
    const { gw } = await searchParams;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    // Validate league
    const { data: league } = await admin
        .from('leagues')
        .select('id, name, commissioner_id')
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

    if (!member && league.commissioner_id !== user.id) redirect('/dashboard');

    // Derive current gameweek natively: highest GW whose deadline has already passed.
    // This avoids relying on FPL's is_current flag which can be stale/cached.
    let currentFplGw = 1;
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
        }
    } catch { /* ignore */ }

    // Determine which gameweek to show (default to FPL current if none specified)
    let targetGw = parseInt(gw ?? '0', 10);
    if (!targetGw) {
        targetGw = currentFplGw;
    }

    // Fetch matchups for target gameweek
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

    // Fetch unique gameweeks for the selector
    const { data: allGws } = await admin
        .from('matchups')
        .select('gameweek')
        .eq('league_id', leagueId)
        .order('gameweek', { ascending: true });

    const gameweeks = Array.from(new Set((allGws ?? []).map((row) => row.gameweek)));

    // Identify which teams are playing in a Cup fixture this gameweek
    const { data: activeRounds } = await admin
        .from('tournament_rounds')
        .select('id')
        .eq('tournament_id', leagueId) // filter by league could be done via join, but we can just fetch all rounds overlapping the gameweek
        .lte('start_gameweek', targetGw)
        .gte('end_gameweek', targetGw);

    // Filter by league tournaments
    const { data: leagueTourneys } = await admin.from('tournaments').select('id').eq('league_id', leagueId);
    const tourneyIds = new Set((leagueTourneys || []).map(t => t.id));

    const { data: validRounds } = await admin
        .from('tournament_rounds')
        .select('id, tournament_id')
        .lte('start_gameweek', targetGw)
        .gte('end_gameweek', targetGw);
        
    const roundIds = (validRounds || []).filter(r => tourneyIds.has(r.tournament_id)).map(r => r.id);

    const cupTeamIds = new Set<string>();
    if (roundIds.length > 0) {
        const { data: cupMatchups } = await admin
            .from('tournament_matchups')
            .select('team_a_id, team_b_id')
            .in('round_id', roundIds);

        cupMatchups?.forEach(cm => {
            if (cm.team_a_id) cupTeamIds.add(cm.team_a_id);
            if (cm.team_b_id) cupTeamIds.add(cm.team_b_id);
        });
    }

    // Get user's team ID in this league (for highlighting)
    const { data: myTeam } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Matchups – Gameweek {targetGw}</h1>
                {gameweeks.length > 0 && (
                    <GameweekSelector targetGw={targetGw} gameweeks={gameweeks} />
                )}
            </header>

            {matchups.length === 0 ? (
                <div className={styles.emptyCard}>No matchups found for Gameweek {targetGw}.</div>
            ) : (
                <div className={styles.matchupGrid}>
                    {matchups.map((m) => (
                        <LiveMatchupCard
                            key={m.id}
                            matchup={m}
                            myTeamId={myTeam?.id}
                            currentFplGw={currentFplGw}
                            aHasCup={cupTeamIds.has(m.team_a_id)}
                            bHasCup={cupTeamIds.has(m.team_b_id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
