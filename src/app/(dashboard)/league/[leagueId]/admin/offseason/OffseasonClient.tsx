'use client';

import { useState, useCallback } from 'react';
import styles from './offseason.module.css';
import { Icon } from '@/components/ui/Icon';

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
    seasonPrizes: { teamId: string; teamName: string; prizeKey: string; prizeLabel: string; amount: number }[];
    cupPrizes: { teamId: string; teamName: string; prizeKey: string; prizeLabel: string; amount: number }[];
    totalPrizeFaab: number;
  };
}

interface KickoffPreviewData {
  leagueId: string;
  leagueStatus: string;
  rosterLocked: boolean;
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
    summerArrivals: {
      id: string;
      name: string;
      marketValue: number;
    }[];
  };
}

type ResetPhase = 'idle' | 'loading_preview' | 'preview_ready' | 'confirming' | 'running' | 'done' | 'error';

export default function OffseasonClient({ leagueId, league, cronSecret }: Props) {
  const [phase, setPhase] = useState<ResetPhase>('idle');
  const [preflightData, setPreflightData] = useState<PreflightData | null>(null);
  const [kickoffPreviewData, setKickoffPreviewData] = useState<KickoffPreviewData | null>(null);
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

  const loadKickoffPreview = useCallback(async () => {
    setPhase('loading_preview');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/offseason/kickoff?league_id=${leagueId}`, {
        headers: { 'x-cron-secret': cronSecret },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load kickoff preview');
      setKickoffPreviewData(data);
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

  const runKickoff = async () => {
    setPhase('running');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/offseason/kickoff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': cronSecret,
        },
        body: JSON.stringify({ league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Kickoff failed');
      setResult({
        ...data,
        isKickoff: true,
      });
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
        <h1 className={styles.title}>Season Transition Panel</h1>
        <p className={styles.subtitle}>
          Transition from <strong>{league.current_season}</strong> to the next season.
          First close the active season with a <strong>Season Reset</strong> to archive results and distribute standings balance awards,
          then execute the <strong>Season Kickoff</strong> later in the summer to process permanent relegation drops and open the transfer market.
        </p>
      </header>

      {/* Roster lock status */}
      <div className={styles.statusRow}>
        <div className={`${styles.statusBadge} ${league.roster_locked ? styles.statusLocked : styles.statusOpen}`}>
          {league.roster_locked ? (
            <><Icon name="lock" size={14} style={{ marginRight: '6px' }} /> Rosters Locked</>
          ) : (
            <><Icon name="unlock" size={14} style={{ marginRight: '6px' }} /> Rosters Open</>
          )}
        </div>
        <div className={styles.statusBadge}>
          Status:{' '}<strong>{league.status}</strong>
        </div>
        <div className={styles.statusBadge}>
          Season:{' '}<strong>{league.current_season}</strong>
        </div>
      </div>

      {/* Kickoff Season: Preview Trigger */}
      {alreadyInOffseason && phase === 'idle' && (
        <div className={styles.actionCard}>
          <h2 className={styles.cardTitle}>Step 2 — Kickoff New Season</h2>
          <p className={styles.cardDesc}>
            Load a preview of the upcoming season's roster changes. This will show summer arrivals crossing the Transfermarkt threshold (€40m+) that will be placed on the system auction block, and all relegated or permanently departed players who will be officially dropped and their managers compensated.
          </p>
          <button className={styles.btnPrimary} onClick={loadKickoffPreview}>
            Load Kickoff Preview
          </button>
        </div>
      )}

      {/* Load Preview */}
      {phase === 'idle' && !alreadyInOffseason && (
        <div className={styles.actionCard}>
          <h2 className={styles.cardTitle}>Step 1 — Run Preflight Check</h2>
          <p className={styles.cardDesc}>
            Before resetting the season, load a preview of final standings prizes, Cup payouts, and matchup status checks. Relegation drops are delayed until the summer kickoff to give players a grace period to transfer back to the Prem.
          </p>
          <button className={styles.btnPrimary} onClick={loadPreview}>
            Load Preview
          </button>
        </div>
      )}

      {phase === 'loading_preview' && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <p>Running preflight and preview analysis…</p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className={styles.alertBox} data-type="error">
          <span className={styles.alertIcon}><Icon name="x" size={16} /></span>
          <span>{errorMsg}</span>
          <button className={styles.btnSmall} onClick={alreadyInOffseason ? loadKickoffPreview : loadPreview}>Retry</button>
        </div>
      )}

      {/* RESET PREVIEW */}
      {(phase === 'preview_ready' || phase === 'confirming') && preflightData && !alreadyInOffseason && (
        <>
          {/* Preflight status */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Preflight Check</h2>
            {preflightData.preflight.ready ? (
              <div className={styles.alertBox} data-type="success">
                <span className={styles.alertIcon}><Icon name="check" size={16} /></span>
                <span>All checks passed — season is complete and ready to reset.</span>
              </div>
            ) : (
              <div className={styles.alertBox} data-type="error">
                <span className={styles.alertIcon} style={{ display: 'flex', alignItems: 'center' }}><Icon name="alert" size={16} /></span>
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
            <p className={styles.cardDesc} style={{ marginTop: '10px' }}>
              ℹ️ Relegated and departed players remain on rosters throughout the summer as a <strong>Grace Period</strong> in case they secure transfers back to a Premier League team before kickoff!
            </p>
          </section>

          {/* Season prizes */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Regular Season Prizes
              <span className={styles.sectionBadge}>€{preflightData.preview.totalPrizeFaab}m total prize payout</span>
            </h2>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Prize</th>
                    <th>Prize Award</th>
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
                      <th>Prize Award</th>
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
                pay out all standings and tournament prizes, delete all matchups and brackets for regeneration,
                and transition the league to offseason mode.
              </p>
              <button className={styles.btnDanger} onClick={() => setPhase('confirming')}>
                I Understand — Proceed to Confirm
              </button>
            </div>
          )}

          {phase === 'confirming' && (
            <div className={styles.confirmBox}>
              <p className={styles.confirmText} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <Icon name="alert" size={20} style={{ color: 'var(--color-accent-red, #ef4444)', flexShrink: 0, marginTop: '2px' }} />
                <span>
                  <strong>Are you absolutely sure?</strong><br />
                  This will permanently close the <strong>{preflightData.seasonFrom}</strong> season
                  and cannot be undone. All prizes will be paid, rosters will be locked,
                  and matchup/cup data will be cleared.
                </span>
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

      {/* KICKOFF PREVIEW */}
      {phase === 'preview_ready' && kickoffPreviewData && alreadyInOffseason && (
        <>
          {/* Relegation Compensation */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Summer Relegation & Transfer Departures
              <span className={styles.sectionBadge}>{kickoffPreviewData.preview.relegationPlayers.length} players</span>
            </h2>
            <p className={styles.cardDesc} style={{ marginBottom: '15px' }}>
              These players have officially departed the Premier League (either via team relegation or permanent transfer abroad) and did not secure a transfer back to the Prem during the summer grace period. They will be dropped from fantasy rosters and their managers compensated with <strong>80% of their market value</strong>.
            </p>
            {kickoffPreviewData.preview.relegationPlayers.length === 0 ? (
              <p className={styles.emptyState}>No relegated or departed players are rostered — no payouts needed.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Club</th>
                      <th>Market Value</th>
                      <th>Cash Payout (80%)</th>
                      <th>Roster Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kickoffPreviewData.preview.relegationPlayers.map((p) => (
                      <tr key={p.playerId}>
                        <td className={styles.playerName}>{p.playerName}</td>
                        <td className={styles.clubName}>{p.club}</td>
                        <td>€{p.marketValue.toFixed(1)}m</td>
                        <td className={styles.faabAmount}>+{p.compensationFaab.toFixed(1)}</td>
                        <td>{p.ownedBy.map((o) => o.teamName).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}><strong>Total Compensation Paid</strong></td>
                      <td className={styles.faabAmount}><strong>+{kickoffPreviewData.preview.totalRelegationFaab.toFixed(1)}</strong></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Summer Arrivals */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Summer arrivals on Auction
              <span className={styles.sectionBadge}>{kickoffPreviewData.preview.summerArrivals.length} players</span>
            </h2>
            <p className={styles.cardDesc} style={{ marginBottom: '15px' }}>
              These are brand-new high-value arrivals (Transfermarkt value <strong>&gt;= €40m</strong>) who entered the league over the summer. To ensure fairness, they will be placed on the <strong>48-hour transfer auction block</strong> immediately upon kickoff, rather than being claimable via standard first-come-first-served free agency.
            </p>
            {kickoffPreviewData.preview.summerArrivals.length === 0 ? (
              <p className={styles.emptyState}>No high-value summer arrivals detected.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Transfermarkt Value</th>
                      <th>Auction Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kickoffPreviewData.preview.summerArrivals.map((p) => (
                      <tr key={p.id}>
                        <td className={styles.playerName}>{p.name}</td>
                        <td>€{p.marketValue.toFixed(1)}m</td>
                        <td className={styles.faabAmount}>Pending (48H Auction)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Execute Kickoff Card */}
          <div className={styles.actionCard} data-type="danger">
            <h2 className={styles.cardTitle}>Confirm & Kickoff Season</h2>
            <p className={styles.cardDesc}>
              This will officially begin the new season! Rosters will be <strong>unlocked</strong>, the league status will be updated to <strong>active</strong>, all pending relegated/departed players will be permanently dropped with cash payouts, and the 48-hour summer auctions will be created.
            </p>
            <button className={styles.btnPrimary} onClick={runKickoff}>
              Yes — Start New Season
            </button>
          </div>
        </>
      )}

      {/* Running */}
      {phase === 'running' && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <p>Processing season transition… this may take up to 30 seconds.</p>
        </div>
      )}

      {/* Done (Kickoff Result) */}
      {phase === 'done' && result?.isKickoff && (
        <div className={styles.resultSection}>
          <div className={styles.alertBox} data-type="success">
            <span className={styles.alertIcon} style={{ display: 'flex', alignItems: 'center' }}><Icon name="star" size={16} /></span>
            <span>
              The new season has officially begun! Rosters are unlocked.
            </span>
          </div>

          <div className={styles.resultGrid} style={{ marginBottom: '30px' }}>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.relegationResults?.length ?? 0}</span>
              <span className={styles.resultLabel}>Departed Players Dropped</span>
            </div>
            <div className={styles.resultCard}>
              <span className={styles.resultNumber}>{result.auctionsCreated}</span>
              <span className={styles.resultLabel}>Marquee Summer Auctions Seeded</span>
            </div>
          </div>

          {result.relegationResults?.length > 0 && (
            <div className={styles.nextStepsCard} style={{ marginBottom: '20px' }}>
              <h2 className={styles.cardTitle}>Completed Relegation drops & Payouts</h2>
              <ul className={styles.nextStepsList}>
                {result.relegationResults.map((r: any) => (
                  <li key={r.playerId}>
                    ❌ <strong>{r.playerName}</strong> ({r.club}) dropped — Owners compensated: {r.affectedRosters.map((t: any) => `${t.teamName} (+€${r.compensationFaab}m)`).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.nextStepsCard}>
            <h2 className={styles.cardTitle}>Summer Auction Block Activated</h2>
            <p className={styles.cardDesc}>
              Managers have <strong>48 hours</strong> to place their initial bids on the following new marquee arrivals:
            </p>
            {result.auctionedPlayers?.length > 0 ? (
              <ul className={styles.nextStepsList}>
                {result.auctionedPlayers.map((name: string, i: number) => (
                  <li key={i}>⭐ <strong>{name}</strong></li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyState}>No summer arrivals placed on the auction block.</p>
            )}
          </div>
        </div>
      )}

      {/* Done (Reset Result) */}
      {phase === 'done' && result && !result.isKickoff && (
        <div className={styles.resultSection}>
          <div className={styles.alertBox} data-type="success">
            <span className={styles.alertIcon} style={{ display: 'flex', alignItems: 'center' }}><Icon name="star" size={16} /></span>
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
              <span className={styles.resultNumber}>+€{result.totalPrizeFaab}m</span>
              <span className={styles.resultLabel}>Total Cash Distributed</span>
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
            <h2 className={styles.cardTitle}>Reset Complete — Grace Period Active</h2>
            <p className={styles.cardDesc}>
              The old season has been archived, prizes paid, and new schedules/brackets have been generated for <strong>{result.seasonTo}</strong>.
              Rosters are locked. Relegated players will remain on rosters as a grace period. 
              Run the <strong>Kickoff</strong> later in the summer when you are ready to process final relegation drops and activate the league!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
