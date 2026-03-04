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

    // Determine which gameweek to show (default to latest non-completed if none specified)
    let targetGw = parseInt(gw ?? '0', 10);
    if (!targetGw) {
        const { data: latest } = await admin
            .from('matchups')
            .select('gameweek')
            .eq('league_id', leagueId)
            .neq('status', 'completed')
            .order('gameweek', { ascending: true })
            .limit(1)
            .single();

        // If all completed, get the absolute max
        if (latest) {
            targetGw = latest.gameweek;
        } else {
            const { data: absoluteLatest } = await admin
                .from('matchups')
                .select('gameweek')
                .eq('league_id', leagueId)
                .order('gameweek', { ascending: false })
                .limit(1)
                .single();

            targetGw = absoluteLatest?.gameweek ?? 1;
        }
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
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
