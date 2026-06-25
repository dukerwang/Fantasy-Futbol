'use client';

import styles from './history.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StandingRow {
  season: string;
  final_rank: number;
  total_points: number;
  archived_at: string;
  team: {
    id: string;
    team_name: string;
    user: { username: string } | null;
  } | null;
}

interface SeasonEntry {
  season: string;
  standings: StandingRow[];
  cupWinners: Record<string, string>;
}

interface HighestGwScore {
  teamName: string;
  score: number;
  gameweek: number;
}

interface Props {
  leagueName: string;
  currentSeason: string;
  seasons: SeasonEntry[];
  highestGwScore: HighestGwScore | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];
const CUP_ICONS: Record<string, string> = {
  'Champions Cup': '🏆',
  'Consolation Cup': '🎖️',
  'League Cup': '🏅',
};

function medalStyle(rank: number) {
  if (rank === 1) return { border: '2px solid #D4AF37', background: 'rgba(212,175,55,0.06)' };
  if (rank === 2) return { border: '2px solid #A8A9AD', background: 'rgba(168,169,173,0.06)' };
  if (rank === 3) return { border: '2px solid #CD7F32', background: 'rgba(205,127,50,0.06)' };
  return {};
}

// ─── Season Panel ─────────────────────────────────────────────────────────────

function SeasonPanel({ entry }: { entry: SeasonEntry }) {
  const champion = entry.standings.find(s => s.final_rank === 1);
  const top3 = entry.standings.slice(0, 3);
  const hasCups = Object.keys(entry.cupWinners).length > 0;

  return (
    <article className={styles.seasonPanel}>
      {/* Season header */}
      <div className={styles.seasonHeader}>
        <div className={styles.seasonHeaderLeft}>
          <span className={styles.seasonBadge}>{entry.season}</span>
          <div>
            <h2 className={styles.seasonTitle}>Season {entry.season}</h2>
            {champion && (
              <p className={styles.seasonChampion}>
                🥇 Champion: <strong>{champion.team?.team_name ?? 'Unknown'}</strong>
                {champion.team?.user?.username ? ` · ${champion.team.user.username}` : ''}
              </p>
            )}
          </div>
        </div>

        {/* Cup winners */}
        {hasCups && (
          <div className={styles.cupRow}>
            {Object.entries(entry.cupWinners).map(([cupName, winner]) => (
              <div key={cupName} className={styles.cupBadge}>
                <span className={styles.cupIcon}>{CUP_ICONS[cupName] ?? '🏆'}</span>
                <div>
                  <span className={styles.cupName}>{cupName}</span>
                  <span className={styles.cupWinner}>{winner}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Podium — top 3 */}
      {top3.length > 0 && (
        <div className={styles.podium}>
          {top3.map(row => {
            const medal = MEDALS[row.final_rank - 1] ?? `#${row.final_rank}`;
            return (
              <div key={row.final_rank} className={`${styles.podiumCard} ${row.final_rank === 1 ? styles.podiumCardFirst : ''}`} style={medalStyle(row.final_rank)}>
                <span className={styles.podiumMedal}>{medal}</span>
                <span className={styles.podiumTeam}>{row.team?.team_name ?? 'Unknown'}</span>
                <span className={styles.podiumManager}>{row.team?.user?.username ?? ''}</span>
                <span className={styles.podiumPts}>{row.total_points?.toLocaleString()} pts</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Full standings table */}
      {entry.standings.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                <th>#</th>
                <th className={styles.thTeam}>Team</th>
                <th className={styles.thManager}>Manager</th>
                <th className={styles.thPts}>Points</th>
              </tr>
            </thead>
            <tbody>
              {entry.standings.map(row => (
                <tr key={row.final_rank} className={`${styles.tableRow} ${row.final_rank <= 3 ? styles.tableRowMedal : ''}`}>
                  <td className={styles.tdRank}>
                    {row.final_rank <= 3 ? (
                      <span className={styles.medalBadge}>{MEDALS[row.final_rank - 1]}</span>
                    ) : (
                      <span className={styles.rankNum}>{row.final_rank}</span>
                    )}
                  </td>
                  <td className={styles.tdTeam}>{row.team?.team_name ?? 'Unknown'}</td>
                  <td className={styles.tdManager}>{row.team?.user?.username ?? '—'}</td>
                  <td className={styles.tdPts}>{row.total_points?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.emptyText}>No standings recorded for this season.</p>
      )}
    </article>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HistoryClient({ leagueName, currentSeason, seasons, highestGwScore }: Props) {
  const hasHistory = seasons.length > 0;

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{leagueName} · Dynasty League</p>
          <h1 className={styles.title}>League History</h1>
          <p className={styles.subtitle}>Past season standings, cup winners & records</p>
        </div>
      </header>

      {/* ── All-time records strip ── */}
      {highestGwScore && (
        <div className={styles.recordsStrip}>
          <span className={styles.recordsKicker}>ALL-TIME RECORDS</span>
          <div className={styles.recordsGrid}>
            <div className={styles.recordCard}>
              <span className={styles.recordIcon}>⚡</span>
              <div>
                <span className={styles.recordLabel}>Highest Single GW Score</span>
                <span className={styles.recordValue}>{highestGwScore.score.toFixed(1)} pts</span>
                <span className={styles.recordMeta}>{highestGwScore.teamName} · GW{highestGwScore.gameweek}</span>
              </div>
            </div>
            <div className={styles.recordCard}>
              <span className={styles.recordIcon}>📖</span>
              <div>
                <span className={styles.recordLabel}>Seasons Played</span>
                <span className={styles.recordValue}>{seasons.length}</span>
                <span className={styles.recordMeta}>Since Season {seasons[seasons.length - 1]?.season ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!hasHistory ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📜</div>
          <h2 className={styles.emptyTitle}>The History Books Are Empty</h2>
          <p className={styles.emptyDesc}>
            Season archives will appear here once a season is completed and saved.
            <br />
            Current season: <strong>{currentSeason}</strong>
          </p>
        </div>
      ) : (
        <div className={styles.seasonList}>
          {seasons.map(entry => (
            <SeasonPanel key={entry.season} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
