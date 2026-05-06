'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './offseason.module.css';

interface League {
  id: string;
  name: string;
  status: string;
  current_season: string;
  previous_season: string | null;
  roster_locked: boolean;
  prize_config: Record<string, number> | null;
}

interface Props {
  leagueId: string;
  league: League;
  cronSecret: string;
}

interface PreflightData {
  leagueId: string;
  seasonFrom: string;
  seasonTo: string;
  leagueStatus: string;
  rosterLocked: boolean;
  preflight: {
    ready: boolean;
    issues: string[];
    incompleteMatchups: number;
    incompleteTournaments: { id: string; name: string }[];
  };
  preview: {
    relegationPlayers: {
      playerId: string;
      playerName: string;
      club: string;
      marketValue: number;
      compensationFaab: number;
      ownedBy: { teamName: string; leagueId: string }[];
    }[];
    totalRelegationFaab: number;
    seasonPrizes: { teamId: string; teamName: string; prizeKey: string; prizeLabel: string; amount: number }[];
    cupPrizes: { teamId: string; teamName: string; prizeKey: string; prizeLabel: string; amount: number }[];
    totalPrizeFaab: number;
  };
}

type ResetPhase = 'idle' | 'loading_preview' | 'preview_ready' | 'confirming' | 'running' | 'done' | 'error';

export default function OffseasonClient({ leagueId, league, cronSecret }: Props) {
  const [phase, setPhase] = useState<ResetPhase>('idle');
  const [preflightData, setPreflightData] = useState<PreflightData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const loadPreview = useCallback(async () => {
    setPhase('loading_preview');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/offseason/reset?league_id=${leagueId}`, {
        headers: { 'x-cron-secret': cronSecret },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load preview');
      setPreflightData(data);
      setPhase('preview_ready');
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  }, [leagueId, cronSecret]);

  const runReset = async () => {
    if (!preflightData) return;
    setPhase('running');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/offseason/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': cronSecret,
        },
        body: JSON.stringify({
          league_id: leagueId,
          season_from: preflightData.seasonFrom,
          season_to: preflightData.seasonTo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reset failed');
      setResult(data);
      setPhase('done');
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  };

  const alreadyInOffseason = league.status === 'offseason';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{league.name} · Commissioner Tools</p>
        <h1 className={styles.title}>End-of-Season Reset</h1>
        <p className={styles.subtitle}>
          Transition from <strong>{league.current_season}</strong> to the next season.
          This will archive standings, distribute prizes, process relegation compensation,
          and clear the match schedule for regeneration.
        </p>
      </header>

      {/* Already done */}
      {alreadyInOffseason && phase !== 'done' && (
        <div className={styles.alertBox} data-type="info">
          <span className={styles.alertIcon}>ℹ️</span>
          <span>This league is already in offseason mode. The reset has been run for this season.</span>
        </div>
      )}

      {/* Roster lock status */}
      <div className={styles.statusRow}>
        <div className={`${styles.statusBadge} ${league.roster_locked ? styles.statusLocked : styles.statusOpen}`}>
          {league.roster_locked ? '🔒 Rosters Locked' : '🔓 Rosters Open'}
        </div>
        <div className={styles.statusBadge}>
          Status: <strong>{league.status}</strong>
        </div>
        <div className={styles.statusBadge}>
          Season: <strong>{league.current_season}</strong>
        </div>
      </div>

      {/* Load Preview */}
      {phase === 'idle' && !alreadyInOffseason && (
        <div className={styles.actionCard}>
          <h2 className={styles.cardTitle}>Step 1 — Run Preflight Check</h2>
          <p className={styles.cardDesc}>
            Before resetting, load a preview of what will happen: prize payouts,
            relegated players on rosters, and whether all matchups and cups have completed.
          </p>
          <button className={styles.btnPrimary} onClick={loadPreview}>
            Load Preview
          </button>
        </div>
      )}

      {phase === 'loading_preview' && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <p>Running preflight checks…</p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className={styles.alertBox} data-type="error">
          <span className={styles.alertIcon}>❌</span>
          <span>{errorMsg}</span>
          <button className={styles.btnSmall} onClick={loadPreview}>Retry</button>
        </div>
      )}

      {/* Preview */}
      {(phase === 'preview_ready' || phase === 'confirming') && preflightData && (
        <>
          {/* Preflight status */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Preflight Check</h2>
            {preflightData.preflight.ready ? (
              <div className={styles.alertBox} data-type="success">
                <span className={styles.alertIcon}>✅</span>
                <span>All checks passed — season is complete and ready to reset.</span>
              </div>
            ) : (
              <div className={styles.alertBox} data-type="error">
                <span className={styles.alertIcon}>⚠️</span>
                <div>
                  <strong>Season is not ready to reset:</strong>
                  <ul className={styles.issueList}>
                    {preflightData.preflight.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          {/* Season transition */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Season Transition</h2>
            <div className={styles.transitionRow}>
              <div className={styles.seasonBadge}>{preflightData.seasonFrom}</div>
              <span className={styles.arrow}>→</span>
              <div className={`${styles.seasonBadge} ${styles.seasonBadgeNext}`}>{preflightData.seasonTo}</div>
            </div>
          </section>

          {/* Relegated players */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Relegation Compensation
              <span className={styles.sectionBadge}>{preflightData.preview.relegationPlayers.length} players</span>
            </h2>
            {preflightData.preview.relegationPlayers.length === 0 ? (
              <p className={styles.emptyState}>No relegated players are on fantasy rosters — no compensation required.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Club</th>
                      <th>Market Value</th>
                      <th>FAAB Payout (80%)</th>
                      <th>Roster Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preflightData.preview.relegationPlayers.map((p) => (
                      <tr key={p.playerId}>
                        <td className={styles.playerName}>{p.playerName}</td>
                        <td className={styles.clubName}>{p.club}</td>
                        <td>£{p.marketValue.toFixed(1)}m</td>
                        <td className={styles.faabAmount}>+{p.compensationFaab.toFixed(1)}</td>
                        <td>{p.ownedBy.map((o) => o.teamName).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}><strong>Total Relegation FAAB</strong></td>
                      <td className={styles.faabAmount}><strong>+{preflightData.preview.totalRelegationFaab.toFixed(1)}</strong></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Season prizes */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Regular Season Prizes
              <span className={styles.sectionBadge}>{preflightData.preview.totalPrizeFaab} total FAAB</span>
            </h2>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Prize</th>
                    <th>FAAB Award</th>
                  </tr>
                </thead>
                <tbody>
                  {preflightData.preview.seasonPrizes.map((p) => (
                    <tr key={p.prizeKey}>
                      <td className={styles.teamName}>{p.teamName}</td>
                      <td>{p.prizeLabel}</td>
                      <td className={styles.faabAmount}>+{p.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Cup prizes */}
          {preflightData.preview.cupPrizes.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Cup Prizes</h2>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Prize</th>
                      <th>FAAB Award</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preflightData.preview.cupPrizes.map((p, i) => (
                      <tr key={i}>
                        <td className={styles.teamName}>{p.teamName}</td>
                        <td>{p.prizeLabel}</td>
                        <td className={styles.faabAmount}>+{p.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Confirm button */}
          {preflightData.preflight.ready && phase !== 'confirming' && (
            <div className={styles.actionCard} data-type="danger">
              <h2 className={styles.cardTitle}>Step 2 — Confirm & Execute Reset</h2>
              <p className={styles.cardDesc}>
                This action is <strong>irreversible</strong>. It will archive the {preflightData.seasonFrom} season,
                pay out all prizes, process relegation compensation, delete all matchups and
                tournaments for regeneration, and transition the league to offseason mode.
              </p>
              <button className={styles.btnDanger} onClick={() => setPhase('confirming')}>
                I Understand — Proceed to Confirm
              </button>
            </div>
          )}

          {phase === 'confirming' && (
            <div className={styles.confirmBox}>
              <p className={styles.confirmText}>
                ⚠️ <strong>Are you absolutely sure?</strong><br />
                This will permanently close the <strong>{preflightData.seasonFrom}</strong> season
                and cannot be undone. All prizes will be paid, rosters will be locked,
                and matchup data will be cleared.
              </p>
              <div className={styles.confirmButtons}>
                <button className={styles.btnDanger} onClick={runReset}>
                  Yes — Run End-of-Season Reset
                </button>
                <button className={styles.btnSecondary} onClick={() => setPhase('preview_ready')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Running */}
      {phase === 'running' && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <p>Running offseason reset… this may take up to 30 seconds.</p>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && result && (
        <div className={styles.resultSection}>
          <div className={styles.alertBox} data-type="success">
            <span className={styles.alertIcon}>🎉</span>
            <span>
              Season <strong>{result.seasonFrom}</strong> has been closed.
              League is now in offseason mode for <strong>{result.seasonTo}</strong>.
            </span>
          </div>

          <div className={styles.resultGrid}>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.standingsArchived}</span>
              <span className={styles.resultLabel}>Standings Archived</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.prizesPaid?.length ?? 0}</span>
              <span className={styles.resultLabel}>Prizes Paid</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>+{result.totalPrizeFaab}</span>
              <span className={styles.resultLabel}>Total FAAB Distributed</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.relegationResults?.length ?? 0}</span>
              <span className={styles.resultLabel}>Relegation Payouts</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.matchupsReset}</span>
              <span className={styles.resultLabel}>Matchups Cleared</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.tournamentsReset}</span>
              <span className={styles.resultLabel}>Tournaments Cleared</span>
            </div>
          </div>

          <div className={styles.nextStepsCard}>
            <h2 className={styles.cardTitle}>Next Steps</h2>
            <ol className={styles.nextStepsList}>
              <li>Run <code>POST /api/sync/players</code> after the FPL bootstrap updates (mid-June) to pull in promoted clubs' players and seed auctions for high-value newcomers.</li>
              <li>Once rosters are settled, run <code>POST /api/sync/tournaments?action=create</code> for all three cups with the new season's start gameweek.</li>
              <li>Set <code>leagues.roster_locked = false</code> and <code>leagues.status = 'active'</code> when the new season begins.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
