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
      pts: 0,
      pf: 0,
      pa: 0,
      gd: 0,
      played: 0,
    });
  }

  // Tally results from completed matchups using football-style 3/1/0 system
  // Draw rule: gap of ≤ 10 fantasy points = draw
  for (const m of matchups ?? []) {
    const a = standingsMap.get(m.team_a_id);
    const b = standingsMap.get(m.team_b_id);
    if (!a || !b) continue;

    const scoreA = m.score_a ?? 0;
    const scoreB = m.score_b ?? 0;
    const gap = Math.abs(scoreA - scoreB);

    a.pf += scoreA; a.pa += scoreB; a.gd += (scoreA - scoreB); a.played++;
    b.pf += scoreB; b.pa += scoreA; b.gd += (scoreB - scoreA); b.played++;

    if (gap <= DRAW_THRESHOLD) {
      // Draw — 1 pt each
      a.draws++; a.pts += 1;
      b.draws++; b.pts += 1;
    } else if (scoreA > scoreB) {
      a.wins++; a.pts += 3;
      b.losses++;
    } else {
      b.wins++; b.pts += 3;
      a.losses++;
    }
  }

  // Sort: table pts → GD → PF (real football tiebreaker order)
  const standings = [...standingsMap.values()].sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    return y.pf - x.pf;
  });

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
