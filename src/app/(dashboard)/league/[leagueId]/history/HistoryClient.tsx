'use client';

import { Icon } from '@/components/ui/Icon';
import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
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
    crest_config?: any;
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

// Named cups take the medal ramp — the same three tokens the podium's own
// trophy icons use, not a fourth arbitrary hue. An unrecognised cup name
// falls through to plain ink rather than guessing a tier.
const CUP_MEDAL_CLASS: Record<string, string> = {
  'Champions Cup': 'medalGold',
  'League Cup': 'medalSilver',
  'Consolation Cup': 'medalBronze',
};

function medalClassFor(rank: number): string {
  return rank === 1 ? 'medalGold' : rank === 2 ? 'medalSilver' : 'medalBronze';
}

// ─── Season Panel ─────────────────────────────────────────────────────────────

function SeasonPanel({ entry }: { entry: SeasonEntry }) {
  const champion = entry.standings.find(s => s.final_rank === 1);
  const top3 = entry.standings.slice(0, 3);
  const hasCups = Object.keys(entry.cupWinners).length > 0;

  return (
    <article className={`g-panel ${styles.seasonPanel}`}>
      {/* Season header */}
      <div className={styles.seasonHeader}>
        <div>
          <h2 className={styles.seasonTitle}>Season {entry.season}</h2>
          {champion && (
            <p className={styles.seasonChampion}>
              <Icon name="trophy" size={13} className={styles.medalGold} /> Champion:{' '}
              <strong>{champion.team?.team_name ?? 'Unknown'}</strong>
              {champion.team?.user?.username ? ` · ${champion.team.user.username}` : ''}
            </p>
          )}
        </div>

        {/* Cup winners */}
        {hasCups && (
          <div className={styles.cupRow}>
            {Object.entries(entry.cupWinners).map(([cupName, winner]) => {
              const medalClass = styles[CUP_MEDAL_CLASS[cupName] ?? ''] ?? '';
              return (
                <div key={cupName} className={styles.cupBadge}>
                  <Icon name="trophy" size={15} className={medalClass || styles.cupIconPlain} />
                  <div>
                    <span className={`g-label-quiet ${styles.cupName}`}>{cupName}</span>
                    <span className={styles.cupWinner}>{winner}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Podium — top 3, same board grammar as standings: tiers of one panel,
          told apart by a hairline, never separate cards. */}
      {top3.length > 0 && (
        <div className={styles.podium}>
          {top3.map(row => {
            const isLeader = row.final_rank === 1;
            return (
              <div
                key={row.final_rank}
                className={`${styles.podiumTier} ${isLeader ? styles.podiumTierLeader : ''}`}
              >
                <div className={styles.podiumTop}>
                  {row.team?.id && (
                    <CrestBadge config={row.team.crest_config as CrestConfig | null} size={40} teamName={row.team.team_name} teamId={row.team.id} />
                  )}
                  <Icon name="trophy" size={isLeader ? 20 : 16} className={styles[medalClassFor(row.final_rank)]} />
                </div>
                <span className={styles.podiumTeam}>{row.team?.team_name ?? 'Unknown'}</span>
                <span className="g-label-quiet">{row.team?.user?.username ?? ''}</span>
                <span className={styles.podiumPts}>{row.total_points?.toLocaleString()} pts</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Full standings table */}
      {entry.standings.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th className={styles.thTeam}>Team</th>
              <th className={styles.thManager}>Manager</th>
              <th className={styles.thPts}>Points</th>
            </tr>
          </thead>
          <tbody>
            {entry.standings.map(row => (
              <tr key={row.final_rank} className={styles.tableRow}>
                <td className={styles.tdRank}>
                  {row.final_rank <= 3 ? (
                    <Icon name="trophy" size={13} className={styles[medalClassFor(row.final_rank)]} />
                  ) : (
                    <span className={styles.rankNum}>{row.final_rank}</span>
                  )}
                </td>
                <td className={styles.tdTeam}>
                  <div className={styles.tdTeamInner}>
                    {row.team?.id && (
                      <CrestBadge config={row.team.crest_config as CrestConfig | null} size={22} teamName={row.team.team_name} teamId={row.team.id} />
                    )}
                    <span>{row.team?.team_name ?? 'Unknown'}</span>
                  </div>
                </td>
                <td className={styles.tdManager}>{row.team?.user?.username ?? '—'}</td>
                <td className={styles.tdPts}>{row.total_points?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <div className={`${styles.page} g-page`}>
      {/* ── Masthead ── */}
      <header className={styles.masthead}>
        <span className={`g-label ${styles.kicker}`}>{leagueName} · Dynasty league</span>
        <h1 className={styles.title}>League History</h1>
        <p className={styles.subtitle}>Past season standings, cup winners & records</p>
      </header>

      {/* ── All-time records strip ── */}
      {highestGwScore && (
        <div className={`g-panel ${styles.recordsStrip}`}>
          <span className="g-label">All-time records</span>
          <div className={styles.recordsGrid}>
            <div className={styles.recordCard}>
              <Icon name="activity" size={20} className={styles.recordIconAccent} />
              <div>
                <span className="g-label-quiet">Highest single-GW score</span>
                <span className={styles.recordValue}>{highestGwScore.score.toFixed(2)} pts</span>
                <span className={styles.recordMeta}>{highestGwScore.teamName} · GW{highestGwScore.gameweek}</span>
              </div>
            </div>
            <div className={styles.recordCard}>
              <Icon name="layout" size={20} className={styles.recordIconAccent} />
              <div>
                <span className="g-label-quiet">Seasons played</span>
                <span className={styles.recordValue}>{seasons.length}</span>
                <span className={styles.recordMeta}>Since season {seasons[seasons.length - 1]?.season ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!hasHistory ? (
        <div className={`g-panel ${styles.emptyState}`}>
          <Icon name="layout" size={40} className={styles.emptyIcon} />
          <h2 className={styles.emptyTitle}>The history books are empty</h2>
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
