import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import type { Matchup, Team } from '@/types';
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
        .select('id, name')
        .eq('id', leagueId)
        .single();

    if (!league) notFound();

    // Validate membership
    const { data: member } = await admin
        .from('league_members')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member) redirect('/dashboard');

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

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Matchups – Gameweek {targetGw}</h1>
                {gameweeks.length > 0 && (
                    <form className={styles.gwSelector}>
                        <label htmlFor="gw" className={styles.gwLabel}>Jump to Gameweek:</label>
                        <select
                            id="gw"
                            name="gw"
                            className={styles.gwSelect}
                            defaultValue={targetGw}
                            onChange={(e) => {
                                // Client-side form submission using JS works well for a basic selector
                                const url = new URL(window.location.href);
                                url.searchParams.set('gw', e.target.value);
                                window.location.href = url.toString();
                            }}
                        >
                            {gameweeks.map((wk) => (
                                <option key={wk} value={wk}>GW {wk}</option>
                            ))}
                        </select>
                    </form>
                )}
            </header>

            {matchups.length === 0 ? (
                <div className={styles.emptyCard}>No matchups found for Gameweek {targetGw}.</div>
            ) : (
                <div className={styles.matchupGrid}>
                    {matchups.map((m) => {
                        const isLive = m.status === 'live';
                        const isCompleted = m.status === 'completed';

                        return (
                            <div key={m.id} className={`${styles.matchupCard} ${isLive ? styles.live : ''} ${isCompleted ? styles.completed : ''}`}>
                                <div className={styles.statusBadge}>
                                    {m.status.toUpperCase()}
                                </div>

                                <div className={styles.matchupTeams}>
                                    <div className={`${styles.team} ${m.score_a > m.score_b && isCompleted ? styles.winner : ''}`}>
                                        <span className={styles.teamName}>{(m as any).team_a?.team_name ?? 'TBD'}</span>
                                        <span className={styles.score}>{m.score_a.toFixed(1)}</span>
                                    </div>

                                    <div className={styles.vs}>VS</div>

                                    <div className={`${styles.team} ${m.score_b > m.score_a && isCompleted ? styles.winner : ''}`}>
                                        <span className={styles.score}>{m.score_b.toFixed(1)}</span>
                                        <span className={styles.teamName}>{(m as any).team_b?.team_name ?? 'TBD'}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
