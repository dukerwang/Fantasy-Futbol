import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Tournament } from '@/types';
import { TOURNAMENT_LABELS } from '@/types';
import styles from './tournaments.module.css';

interface Props {
    params: Promise<{ leagueId: string }>;
}

export default async function TournamentsPage({ params }: Props) {
    const { leagueId } = await params;

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

    // Group by status
    const active = tournaments.filter(t => t.status === 'active');
    const completed = tournaments.filter(t => t.status === 'completed');
    const pending = tournaments.filter(t => t.status === 'pending');

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <span className={styles.pageSupertitle}>PREMIER LEAGUE 25/26</span>
                <h1 className={styles.title}>Cups</h1>
            </header>

            {tournaments.length === 0 ? (
                <div className={styles.emptyCard}>
                    No tournaments have been created yet.
                </div>
            ) : (
                <>
                    {active.length > 0 && (
                        <section>
                            <h2 className={styles.sectionLabel}>Active</h2>
                            <div className={styles.tournamentGrid}>
                                {active.map(t => (
                                    <TournamentCard key={t.id} tournament={t} leagueId={leagueId} />
                                ))}
                            </div>
                        </section>
                    )}

                    {pending.length > 0 && (
                        <section>
                            <h2 className={styles.sectionLabel}>Upcoming</h2>
                            <div className={styles.tournamentGrid}>
                                {pending.map(t => (
                                    <TournamentCard key={t.id} tournament={t} leagueId={leagueId} />
                                ))}
                            </div>
                        </section>
                    )}

                    {completed.length > 0 && (
                        <section>
                            <h2 className={styles.sectionLabel}>Completed</h2>
                            <div className={styles.tournamentGrid}>
                                {completed.map(t => (
                                    <TournamentCard key={t.id} tournament={t} leagueId={leagueId} />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

function TournamentCard({ tournament, leagueId }: { tournament: Tournament; leagueId: string }) {
    const labels = TOURNAMENT_LABELS[tournament.type];
    const statusClass =
        tournament.status === 'active' ? styles.statusActive
            : tournament.status === 'completed' ? styles.statusCompleted
                : styles.statusPending;

    return (
        <Link
            href={`/league/${leagueId}/tournaments/${tournament.id}`}
            className={styles.cardLink}
        >
            <div className={`${styles.card} ${statusClass}`}>
                <div className={styles.cardContent}>
                    <span className={styles.cardBadge}>{labels.short}</span>
                    <h3 className={styles.cardName}>{tournament.name}</h3>
                </div>
                <div className={styles.cardFooter}>
                    <span className={styles.cardStatus}>{tournament.status}</span>
                </div>
            </div>
        </Link>
    );
}
