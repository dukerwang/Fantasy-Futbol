import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from './league.module.css';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function LeaguePage({ params }: Props) {
  const { leagueId } = await params;

  // Auth check via session client
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Data fetching via admin client (bypasses RLS — we enforce access manually)
  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Enforce access: must be commissioner or member
  const { data: membership } = await admin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  const { data: teams } = await admin
    .from('teams')
    .select('*, user:users(username)')
    .eq('league_id', leagueId)
    .order('total_points', { ascending: false });

  const { data: recentMatchups } = await admin
    .from('matchups')
    .select('*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('league_id', leagueId)
    .order('gameweek', { ascending: false })
    .limit(5);

  return (
    <div>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href="/dashboard">Dashboard</Link> / {league.name}
          </p>
          <h1 className={styles.leagueName}>{league.name}</h1>
          <p className={styles.season}>{league.season} Season</p>
        </div>
        <div className={styles.headerActions}>
          {league.commissioner_id === user.id && (
            <span className={styles.commissionerBadge}>Commissioner</span>
          )}
          <Link href={`/league/${leagueId}/standings`} className={styles.actionBtn}>
            Standings
          </Link>
          <Link href={`/league/${leagueId}/fixtures`} className={styles.actionBtn}>
            Fixtures
          </Link>
          {league.status === 'setup' && (
            <Link href={`/draft/${leagueId}`} className={styles.primaryBtn}>
              Go to Draft
            </Link>
          )}
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Standings</h2>
          <div className={styles.standingsTable}>
            <div className={styles.tableHeader}>
              <span className={styles.rankCol}>#</span>
              <span className={styles.teamCol}>Team</span>
              <span className={styles.numCol}>Pts</span>
            </div>
            {(teams ?? []).map((team: any, i: number) => (
              <div key={team.id} className={`${styles.tableRow} ${team.user_id === user.id ? styles.ownRow : ''}`}>
                <span className={styles.rankCol}>
                  {i + 1 === 1 ? '🥇' : i + 1 === 2 ? '🥈' : i + 1 === 3 ? '🥉' : i + 1}
                </span>
                <div className={styles.teamCol}>
                  <span className={styles.teamRowName}>{team.team_name}</span>
                  <span className={styles.teamRowUser}>{team.user?.username}</span>
                </div>
                <span className={`${styles.numCol} ${styles.pointsNum}`}>
                  {team.total_points.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Recent Results</h2>
          {recentMatchups && recentMatchups.length > 0 ? (
            <div className={styles.matchupList}>
              {recentMatchups.map((m: any) => (
                <div key={m.id} className={styles.matchupRow}>
                  <span className={styles.gwLabel}>GW{m.gameweek}</span>
                  <div className={styles.matchupTeams}>
                    <span className={styles.matchupTeam}>{m.team_a.team_name}</span>
                    <div className={styles.matchupScore}>
                      <span>{m.score_a.toFixed(1)}</span>
                      <span className={styles.scoreDash}>—</span>
                      <span>{m.score_b.toFixed(1)}</span>
                    </div>
                    <span className={`${styles.matchupTeam} ${styles.right}`}>{m.team_b.team_name}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyCard}>No matchups played yet.</p>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>League Info</h2>
          <div className={styles.infoList}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Status</span>
              <span className={styles.infoValue}>{league.status}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Draft Type</span>
              <span className={styles.infoValue}>{league.draft_type}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Dynasty</span>
              <span className={styles.infoValue}>{league.is_dynasty ? 'Yes' : 'No'}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>FAAB Budget</span>
              <span className={styles.infoValue}>£{league.faab_budget}m</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Roster Size</span>
              <span className={styles.infoValue}>{league.roster_size} players</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Invite Code</span>
              <span className={`${styles.infoValue} ${styles.infoCode}`}>{league.invite_code}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
