import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import styles from './dashboard.module.css';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('users')
    .select('username')
    .eq('id', user.id)
    .single();

  // Fetch user's teams with league info
  const { data: teams } = await admin
    .from('teams')
    .select(
      `
      id, team_name, faab_budget, total_points,
      league:leagues(id, name, status, season)
    `
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.greeting}>
            Welcome back, <span className={styles.username}>{profile?.username ?? 'Manager'}</span>
          </h1>
          <p className={styles.subtitle}>Your fantasy football command centre</p>
        </div>
        <div className={styles.headerBtnGroup}>
          <Link href="/league/join" className={styles.secondaryBtnHeader}>
            Join League
          </Link>
          <Link href="/league/create" className={styles.createBtn}>
            + Create League
          </Link>
        </div>
      </header>

      {teams && teams.length > 0 ? (
        <section>
          <h2 className={styles.sectionTitle}>Your Leagues</h2>
          <div className={styles.leagueGrid}>
            {teams.map((team: any) => (
              <Link
                key={team.id}
                href={`/league/${team.league.id}`}
                className={styles.leagueCard}
              >
                <div className={styles.leagueCardHeader}>
                  <span className={styles.leagueName}>{team.league.name}</span>
                  <span
                    className={`${styles.status} ${styles[`status_${team.league.status}`]}`}
                  >
                    {team.league.status}
                  </span>
                </div>
                <p className={styles.teamName}>{team.team_name}</p>
                <div className={styles.leagueStats}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{team.total_points.toFixed(1)}</span>
                    <span className={styles.statLabel}>Pts</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>£{team.faab_budget}m</span>
                    <span className={styles.statLabel}>FAAB</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{team.league.season}</span>
                    <span className={styles.statLabel}>Season</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.empty}>
          <p className={styles.emptyIcon}>🏆</p>
          <h2 className={styles.emptyTitle}>No leagues yet</h2>
          <p className={styles.emptyText}>
            Create a league and invite your friends to get started.
          </p>
          <div className={styles.emptyActions}>
            <Link href="/league/create" className={styles.primaryBtn}>
              Create a League
            </Link>
            <Link href="/league/join" className={styles.secondaryBtn}>
              Join with Invite Code
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
