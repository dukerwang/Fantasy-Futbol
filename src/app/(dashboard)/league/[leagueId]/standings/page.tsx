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
  pts: number;   // league table points: W*3 + D*1
  pf: number;    // fantasy points scored (Points For)
  pa: number;    // fantasy points conceded (Points Against)
  gd: number;    // goal difference (pf - pa)
  played: number;
  rank: number;
}

type FormResult = 'W' | 'D' | 'L';

const MEDALS = ['🥇', '🥈', '🥉'];
const DRAW_MARGIN = 10;

function formatRank(n: number): string {
  return String(n).padStart(2, '0');
}

function computeForm(teamId: string, matchups: any[]): FormResult[] {
  const results: FormResult[] = [];
  for (const m of matchups) {
    if (results.length >= 5) break;

    let myScore: number, theirScore: number;
    if (m.team_a_id === teamId) {
      myScore = m.score_a ?? 0;
      theirScore = m.score_b ?? 0;
    } else if (m.team_b_id === teamId) {
      myScore = m.score_b ?? 0;
      theirScore = m.score_a ?? 0;
    } else {
      continue;
    }

    if (Math.abs(myScore - theirScore) <= DRAW_MARGIN) {
      results.push('D');
    } else if (myScore > theirScore) {
      results.push('W');
    } else {
      results.push('L');
    }
  }
  return results;
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

  // Fetch standings and recent matchups in parallel
  const [{ data: standingsRaw }, { data: recentMatchups }] = await Promise.all([
    admin
      .from('league_standings')
      .select('*')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true }),
    admin
      .from('matchups')
      .select('team_a_id, team_b_id, score_a, score_b, gameweek')
      .eq('league_id', leagueId)
      .eq('status', 'completed')
      .order('gameweek', { ascending: false })
      .limit(100),
  ]);

  const standings: StandingRow[] = (standingsRaw ?? []).map((row: any) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    username: row.username,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    pf: row.points_for ?? 0,
    pa: row.points_against ?? 0,
    gd: row.goal_difference ?? 0,
    pts: row.league_points ?? 0,
    rank: row.rank,
  }));

  // Build form map: teamId → last 5 results
  const formMap = new Map<string, FormResult[]>();
  for (const row of standings) {
    formMap.set(row.teamId, computeForm(row.teamId, recentMatchups ?? []));
  }

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
                    <span className={styles.podiumStatLabel}>Total Pts</span>
                    <span className={styles.podiumStatValue}>{row.pts}</span>
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
                <th>PF</th>
                <th>PA</th>
                <th className={styles.formHeading}>Form</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => {
                const isOwn = row.teamId === myTeamId;
                const form = formMap.get(row.teamId) ?? [];
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
                    <td className={styles.ptsCell}>{row.pts}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.pf.toFixed(1)}</td>
                    <td>{row.pa.toFixed(1)}</td>
                    <td className={styles.formCell}>
                      <div className={styles.formDots}>
                        {form.map((result, idx) => (
                          <span
                            key={idx}
                            className={`${styles.formDot} ${
                              result === 'W'
                                ? styles.formDotW
                                : result === 'D'
                                ? styles.formDotD
                                : styles.formDotL
                            }`}
                          />
                        ))}
                        {/* Pad with grey dots if fewer than 5 results */}
                        {Array.from({ length: Math.max(0, 5 - form.length) }).map((_, idx) => (
                          <span key={`empty-${idx}`} className={`${styles.formDot} ${styles.formDotEmpty}`} />
                        ))}
                      </div>
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
