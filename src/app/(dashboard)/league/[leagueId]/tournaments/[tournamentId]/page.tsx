import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Tournament, TournamentRound, TournamentMatchup } from '@/types';
import TournamentBracket from './TournamentBracket';
import styles from './bracket.module.css';

interface Props {
    params: Promise<{ leagueId: string; tournamentId: string }>;
}

export default async function TournamentDetailPage({ params }: Props) {
    const { leagueId, tournamentId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    // Validate membership
    const { data: member } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member) redirect('/dashboard');

    // Fetch tournament
    const { data: tournament } = await admin
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .eq('league_id', leagueId)
        .single();

    if (!tournament) notFound();

    // Fetch rounds with matchups
    const { data: roundsData } = await admin
        .from('tournament_rounds')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('round_number', { ascending: true });

    const rounds = (roundsData ?? []) as TournamentRound[];

    // Fetch all matchups for all rounds
    const roundIds = rounds.map(r => r.id);
    const { data: matchupsData } = await admin
        .from('tournament_matchups')
        .select(`
            *,
            team_a:teams!tournament_matchups_team_a_id_fkey(id, team_name),
            team_b:teams!tournament_matchups_team_b_id_fkey(id, team_name),
            winner:teams!tournament_matchups_winner_id_fkey(id, team_name)
        `)
        .in('round_id', roundIds.length > 0 ? roundIds : ['00000000-0000-0000-0000-000000000000'])
        .order('bracket_position', { ascending: true });

    const matchups = (matchupsData ?? []) as TournamentMatchup[];

    // Attach matchups to rounds
    const roundsWithMatchups = rounds.map(round => ({
        ...round,
        matchups: matchups.filter(m => m.round_id === round.id),
    }));

    // Find champion
    const finalRound = roundsWithMatchups[roundsWithMatchups.length - 1];
    const finalMatchup = finalRound?.matchups[0];
    const champion = finalMatchup?.winner;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href={`/league/${leagueId}/tournaments`} className={styles.backLink}>
                    &larr; All Cups
                </Link>
                <div className={styles.headerContent}>
                    <h1 className={styles.title}>{(tournament as Tournament).name}</h1>
                    <span className={`${styles.statusBadge} ${
                        tournament.status === 'active' ? styles.badgeActive
                            : tournament.status === 'completed' ? styles.badgeCompleted
                                : styles.badgePending
                    }`}>
                        {tournament.status}
                    </span>
                </div>
            </header>

            {champion && (
                <div className={styles.championBanner}>
                    <span className={styles.championLabel}>Champion</span>
                    <span className={styles.championName}>{champion.team_name}</span>
                </div>
            )}

            <TournamentBracket
                rounds={roundsWithMatchups}
                myTeamId={member.id}
            />
        </div>
    );
}
