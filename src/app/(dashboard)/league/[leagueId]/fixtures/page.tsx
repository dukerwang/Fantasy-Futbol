import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '../league.module.css';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function FixturesPage({ params }: Props) {
  const { leagueId } = await params;

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // League check
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, season, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Membership check
  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Fetch all matchups with team names
  const { data: matchups } = await admin
    .from('matchups')
    .select(
      '*, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)',
    )
    .eq('league_id', leagueId)
    .order('gameweek', { ascending: true });

  // Group by gameweek
  const gwMap = new Map<number, typeof matchups>();
  for (const m of matchups ?? []) {
    if (!gwMap.has(m.gameweek)) gwMap.set(m.gameweek, []);
    gwMap.get(m.gameweek)!.push(m);
  }
  const gameweeks = [...gwMap.entries()].sort(([a], [b]) => a - b);

  return (
    <div>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href="/dashboard">Dashboard</Link> /{' '}
            <Link href={`/league/${leagueId}`}>{league.name}</Link> / Fixtures
          </p>
          <h1 className={styles.leagueName}>Fixtures</h1>
          <p className={styles.season}>{league.season} Season</p>
        </div>
        <div className={styles.headerActions}>
          <Link
            href={`/league/${leagueId}/standings`}
            className={styles.actionBtn}
          >
            Standings
          </Link>
          <Link href={`/league/${leagueId}`} className={styles.actionBtn}>
            League Home
          </Link>
        </div>
      </header>

      {gameweeks.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.emptyCard}>
            No fixtures generated yet. Complete the draft to generate the
            schedule.
          </p>
        </div>
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {gameweeks.map(([gw, gwMatchups]) => (
            <section key={gw} className={styles.card}>
              <h2 className={styles.cardTitle}>Gameweek {gw}</h2>
              <div className={styles.matchupList}>
                {(gwMatchups ?? []).map((m: any) => (
                  <div key={m.id} className={styles.matchupRow}>
                    <div className={styles.matchupTeams}>
                      <span className={styles.matchupTeam}>
                        {m.team_a.team_name}
                      </span>
                      <div className={styles.matchupScore}>
                        {m.status === 'completed' ? (
                          <>
                            <span>{(m.score_a ?? 0).toFixed(1)}</span>
                            <span className={styles.scoreDash}>—</span>
                            <span>{(m.score_b ?? 0).toFixed(1)}</span>
                          </>
                        ) : m.status === 'live' ? (
                          <>
                            <span>{(m.score_a ?? 0).toFixed(1)}</span>
                            <span className={styles.scoreDash}>—</span>
                            <span>{(m.score_b ?? 0).toFixed(1)}</span>
                          </>
                        ) : (
                          <span className={styles.scoreDash}>vs</span>
                        )}
                      </div>
                      <span
                        className={`${styles.matchupTeam} ${styles.right}`}
                      >
                        {m.team_b.team_name}
                      </span>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    completed: 'var(--color-accent-green)',
    live: 'var(--color-accent-yellow)',
    scheduled: 'var(--color-text-muted)',
  };
  const color = colorMap[status] ?? 'var(--color-text-muted)';
  return (
    <span
      style={{
        fontSize: 'var(--text-xs)',
        color,
        flexShrink: 0,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}
