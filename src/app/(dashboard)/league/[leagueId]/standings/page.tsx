import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from '../league.module.css';

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
  pf: number; // points for
  pa: number; // points against
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
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Fetch all teams
  const { data: teams } = await admin
    .from('teams')
    .select('id, team_name, user:users(username)')
    .eq('league_id', leagueId);

  // Fetch all completed matchups
  const { data: matchups } = await admin
    .from('matchups')
    .select('team_a_id, team_b_id, score_a, score_b, status')
    .eq('league_id', leagueId)
    .eq('status', 'completed');

  // Build standings map
  const standingsMap = new Map<string, StandingRow>();
  for (const team of teams ?? []) {
    standingsMap.set(team.id, {
      teamId: team.id,
      teamName: team.team_name,
      username: (team.user as any)?.username ?? '',
      wins: 0,
      losses: 0,
      draws: 0,
      pf: 0,
      pa: 0,
    });
  }

  // Tally results from completed matchups
  for (const m of matchups ?? []) {
    const a = standingsMap.get(m.team_a_id);
    const b = standingsMap.get(m.team_b_id);
    if (!a || !b) continue;

    const scoreA = m.score_a ?? 0;
    const scoreB = m.score_b ?? 0;

    a.pf += scoreA;
    a.pa += scoreB;
    b.pf += scoreB;
    b.pa += scoreA;

    if (scoreA > scoreB) {
      a.wins++;
      b.losses++;
    } else if (scoreB > scoreA) {
      b.wins++;
      a.losses++;
    } else {
      a.draws++;
      b.draws++;
    }
  }

  // Sort: wins desc, then PF desc
  const standings = [...standingsMap.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    return y.pf - x.pf;
  });

  return (
    <div>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href="/dashboard">Dashboard</Link> /{' '}
            <Link href={`/league/${leagueId}`}>{league.name}</Link> / Standings
          </p>
          <h1 className={styles.leagueName}>Standings</h1>
          <p className={styles.season}>{league.season} Season</p>
        </div>
        <div className={styles.headerActions}>
          <Link
            href={`/league/${leagueId}/fixtures`}
            className={styles.actionBtn}
          >
            Fixtures
          </Link>
          <Link href={`/league/${leagueId}`} className={styles.actionBtn}>
            League Home
          </Link>
        </div>
      </header>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Season Standings</h2>
        <div className={styles.standingsTable}>
          {/* Header */}
          <div
            className={styles.tableHeader}
            style={{ gridTemplateColumns: '36px 1fr 40px 40px 40px 70px 70px' }}
          >
            <span className={styles.rankCol}>#</span>
            <span className={styles.teamCol}>Team</span>
            <span className={styles.numCol}>W</span>
            <span className={styles.numCol}>L</span>
            <span className={styles.numCol}>D</span>
            <span className={styles.numCol}>PF</span>
            <span className={styles.numCol}>PA</span>
          </div>

          {standings.length === 0 ? (
            <p className={styles.emptyCard}>No teams yet.</p>
          ) : (
            standings.map((row, i) => (
              <div
                key={row.teamId}
                className={`${styles.tableRow} ${row.teamId === user.id ? styles.ownRow : ''}`}
                style={{
                  gridTemplateColumns: '36px 1fr 40px 40px 40px 70px 70px',
                }}
              >
                <span className={styles.rankCol}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <div className={styles.teamCol}>
                  <span className={styles.teamRowName}>{row.teamName}</span>
                  <span className={styles.teamRowUser}>{row.username}</span>
                </div>
                <span className={styles.numCol}>{row.wins}</span>
                <span className={styles.numCol}>{row.losses}</span>
                <span className={styles.numCol}>{row.draws}</span>
                <span className={styles.numCol}>{row.pf.toFixed(1)}</span>
                <span className={styles.numCol}>{row.pa.toFixed(1)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
