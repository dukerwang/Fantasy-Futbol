import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from './standings.module.css';

export const dynamic = 'force-dynamic';

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
  pts: number;   // league table points: 3W + 1D
  pf: number;    // points for (total fantasy points scored)
  pa: number;    // points against
  gd: number;    // goal difference
  played: number;
  rank: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default async function StandingsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, season, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  const { data: standingsRaw } = await admin
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });

  const standings: StandingRow[] = (standingsRaw ?? []).map((row: any) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    username: row.username,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    pf: row.points_for,
    pa: row.points_against,
    gd: row.goal_difference,
    pts: row.league_points,
    rank: row.rank,
  }));

  const top3 = standings.slice(0, 3);
  // Reorder: 2nd | 1st | 3rd for the podium layout
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2
    ? [top3[1], top3[0]]
    : top3;

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <p className={styles.breadcrumb}>
            <Link href="/dashboard">Dashboard</Link>
            {' / '}
            <Link href={`/league/${leagueId}`}>{league.name}</Link>
            {' / Standings'}
          </p>
          <h1 className={styles.title}>Standings</h1>
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

      {/* Podium — top 3 */}
      {standings.length >= 1 && (
        <div className={styles.podium}>
          {podiumOrder.map((row) => {
            const isLeader = row.rank === 1;
            return (
              <div
                key={row.teamId}
                className={`${styles.podiumCard} ${isLeader ? styles.podiumCardLeader : ''}`}
              >
                <div className={styles.podiumMedal}>{MEDALS[row.rank - 1] ?? row.rank}</div>
                {isLeader && (
                  <div className={styles.podiumLeaderBadge}>
                    ★ League Leader
                  </div>
                )}
                <h2 className={styles.podiumTeamName}>{row.teamName}</h2>
                <p className={styles.podiumManager}>Manager: {row.username}</p>
                <p className={styles.podiumRecord}>
                  {row.wins}
                  <span className={styles.podiumRecordSep}>-</span>
                  {row.draws}
                  <span className={styles.podiumRecordSep}>-</span>
                  {row.losses}
                </p>
                <div className={styles.podiumStats}>
                  <span className={styles.podiumStatLabel}>Total Points</span>
                  <span className={styles.podiumStatValue}>{row.pf.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full standings table */}
      <section className={styles.tableSection}>
        <div className={styles.tableSectionHeader}>
          <h2 className={styles.tableSectionTitle}>Season Standings</h2>
          <span className={styles.tableRule}>
            W=3pts · D=1pt · L=0pts · Draw if gap ≤10 pts
          </span>
        </div>

        {standings.length === 0 ? (
          <p className={styles.emptyState}>No completed matches yet — check back after Gameweek 1.</p>
        ) : (
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                <th>#</th>
                <th className={styles.teamHeading}>Team</th>
                <th>MP</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>PF</th>
                <th>GD</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr
                  key={row.teamId}
                  className={`${styles.tableRow} ${row.teamId === membership?.id ? styles.ownRow : ''}`}
                >
                  <td className={styles.rankCell}>
                    {i < 3 ? MEDALS[i] : i + 1}
                  </td>
                  <td className={styles.teamCell}>
                    <div className={styles.teamCellInner}>
                      <span className={styles.teamCellName}>{row.teamName}</span>
                      <span className={styles.teamCellManager}>{row.username}</span>
                    </div>
                  </td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.draws}</td>
                  <td>{row.losses}</td>
                  <td>{row.pf.toFixed(1)}</td>
                  <td className={row.gd >= 0 ? styles.gdPos : styles.gdNeg}>
                    {row.gd >= 0 ? '+' : ''}{row.gd.toFixed(1)}
                  </td>
                  <td className={styles.ptsCell}>{row.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </div>
  );
}
