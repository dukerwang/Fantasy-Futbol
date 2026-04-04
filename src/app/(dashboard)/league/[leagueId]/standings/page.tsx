import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
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
  pts: number;
  pf: number;
  pa: number;
  gd: number;
  played: number;
  rank: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function formatRank(n: number): string {
  return String(n).padStart(2, '0');
}

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
  // Podium order: 2nd | 1st | 3rd
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2
    ? [top3[1], top3[0]]
    : top3;

  const myTeamId = membership?.id;

  return (
    <div className={styles.page}>

      {/* Header */}
      <header className={styles.header}>
        <p className={styles.eyebrow}>{league.name} · Season {league.season}</p>
        <h1 className={styles.title}>Standings</h1>
        <p className={styles.subtitle}>Dynasty format · Season winner takes all</p>
      </header>

      {/* Podium */}
      {standings.length >= 1 && (
        <div className={styles.podium}>
          {podiumOrder.map((row) => {
            const isLeader = row.rank === 1;
            return (
              <div
                key={row.teamId}
                className={`${styles.podiumCard} ${isLeader ? styles.podiumCardLeader : ''}`}
              >
                <span className={styles.podiumEmoji}>{MEDALS[row.rank - 1]}</span>

                {isLeader && (
                  <div className={styles.podiumLeaderBadge}>★ League Leader</div>
                )}

                <h2 className={styles.podiumTeamName}>{row.teamName}</h2>
                <p className={styles.podiumManager}>{row.username}</p>

                <div className={styles.podiumBottom}>
                  <div className={styles.podiumRecordGroup}>
                    <span className={styles.podiumStatLabel}>Record</span>
                    <span className={styles.podiumRecord}>
                      {row.wins}-{row.draws}-{row.losses}
                    </span>
                  </div>
                  <div className={styles.podiumPointsGroup}>
                    <span className={styles.podiumStatLabel}>Total Points</span>
                    <span className={styles.podiumStatValue}>{row.pf.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full standings table */}
      <section className={styles.tableSection}>
        {standings.length === 0 ? (
          <p className={styles.emptyState}>No completed matches yet — check back after Gameweek 1.</p>
        ) : (
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                <th>#</th>
                <th className={styles.teamHeading}>Team</th>
                <th className={styles.managerHeading}>Manager</th>
                <th>Pts</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GD</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => {
                const isOwn = row.teamId === myTeamId;
                return (
                  <tr
                    key={row.teamId}
                    className={`${styles.tableRow} ${isOwn ? styles.ownRow : ''}`}
                  >
                    <td className={styles.rankCell}>{formatRank(i + 1)}</td>
                    <td className={styles.teamCell}>
                      <span className={styles.teamCellName}>{row.teamName}</span>
                    </td>
                    <td className={styles.managerCell}>{row.username}</td>
                    <td className={styles.ptsCell}>{row.pf.toFixed(1)}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td className={row.gd >= 0 ? styles.gdPos : styles.gdNeg}>
                      {row.gd >= 0 ? '+' : ''}{row.gd.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

    </div>
  );
}
