import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '../league.module.css';

export const dynamic = 'force-dynamic';

const DRAW_THRESHOLD = 10; // points gap ≤ this = draw

interface Props {
  params: Promise<{ leagueId: string }>;
}

interface StandingRow {
  teamId: string;
  teamName: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  pts: number;  // table points: 3W + 1D
  pf: number;  // points for
  pa: number;  // points against
  gd: number;  // goal difference (pf - pa)
  played: number;
}

export default async function StandingsPage({ params }: Props) {
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

  // Fetch all teams with their standings from the view
  const { data: standingsRaw } = await admin
    .from('league_standings')
    .select(`
      *,
      team:teams(
        team_name,
        user:users(username)
      )
    `)
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });

  const standings: StandingRow[] = (standingsRaw ?? []).map((row: any) => ({
    teamId: row.team_id,
    teamName: row.team?.team_name ?? 'Unknown',
    username: row.team?.user?.username ?? 'Unknown',
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    pf: row.points_for,
    pa: row.points_against,
    gd: row.goal_difference,
    pts: row.league_points,
  }));

  return (
    <div>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href="/dashboard">Dashboard</Link> {' '}
            <Link href={`/league/${leagueId}`}>{league.name}</Link> / Standings
          </p>
          <h1 className={styles.leagueName}>Standings</h1>
          <p className={styles.season}>{league.season} Season</p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`/league/${leagueId}/fixtures`} className={styles.actionBtn}>
            Fixtures
          </Link>
          <Link href={`/league/${leagueId}`} className={styles.actionBtn}>
            League Home
          </Link>
        </div>
      </header>

      <section className={styles.card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>Season Standings</h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>
            W=3pts · D=1pt · L=0pts · Draw if gap ≤10 pts
          </span>
        </div>
        <div className={styles.standingsTable}>
          {/* Header */}
          <div
            className={styles.tableHeader}
            style={{ gridTemplateColumns: '36px 1fr 42px 42px 42px 42px 70px 70px 60px' }}
          >
            <span className={styles.rankCol}>#</span>
            <span className={styles.teamCol}>Team</span>
            <span className={styles.numCol}>MP</span>
            <span className={styles.numCol}>W</span>
            <span className={styles.numCol}>D</span>
            <span className={styles.numCol}>L</span>
            <span className={styles.numCol}>PF</span>
            <span className={styles.numCol}>GD</span>
            <span className={styles.numCol} style={{ fontWeight: 800, color: 'var(--color-text-primary, #f3f4f6)' }}>Pts</span>
          </div>

          {standings.length === 0 ? (
            <p className={styles.emptyCard}>No completed matches yet.</p>
          ) : (
            standings.map((row, i) => (
              <div
                key={row.teamId}
                className={`${styles.tableRow} ${row.teamId === membership?.id ? styles.ownRow : ''}`}
                style={{ gridTemplateColumns: '36px 1fr 42px 42px 42px 42px 70px 70px 60px' }}
              >
                <span className={styles.rankCol}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <div className={styles.teamCol}>
                  <span className={styles.teamRowName}>{row.teamName}</span>
                  <span className={styles.teamRowUser}>{row.username}</span>
                </div>
                <span className={styles.numCol}>{row.played}</span>
                <span className={styles.numCol}>{row.wins}</span>
                <span className={styles.numCol}>{row.draws}</span>
                <span className={styles.numCol}>{row.losses}</span>
                <span className={styles.numCol}>{row.pf.toFixed(1)}</span>
                <span className={styles.numCol} style={{ color: row.gd >= 0 ? '#10b981' : '#ef4444' }}>
                  {row.gd >= 0 ? '+' : ''}{row.gd.toFixed(1)}
                </span>
                <span className={styles.numCol} style={{ fontWeight: 800, fontSize: '1rem' }}>{row.pts}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
