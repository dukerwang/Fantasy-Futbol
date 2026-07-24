'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './offseason.module.css';
import { Icon } from '@/components/ui/Icon';

interface ResetReadyLeague {
  leagueId: string;
  leagueName: string;
  seasonFrom: string;
  seasonTo: string;
  totalPrizeFaab: number;
}

interface ResetNotReadyLeague {
  leagueId: string;
  leagueName: string;
  issues: string[];
}

interface ResetPreviewData {
  ready: ResetReadyLeague[];
  notReady: ResetNotReadyLeague[];
}

interface ResetResultRow {
  leagueId: string;
  leagueName: string;
  ok: boolean;
  error?: string;
  totalPrizeFaab?: number;
}

interface KickoffLeaguePreview {
  leagueId: string;
  leagueName: string;
  relegationPlayers: { playerId: string; playerName: string; club: string; compensationFaab: number }[];
  totalRelegationFaab: number;
  summerArrivals: { id: string; name: string; marketValue: number; isPromoted: boolean }[];
}

interface KickoffPreviewData {
  leagues: KickoffLeaguePreview[];
}

interface PreflightIssue {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  detail?: string[];
}

interface PreflightLeague {
  leagueId: string;
  leagueName: string;
  ready: boolean;
  issues: PreflightIssue[];
  summary: {
    auctionsToCreate: number;
    promotedClubs: string[];
    departuresToProcess: number;
    compensationTotal: number;
  };
}

interface PreflightData {
  ready: boolean;
  leagues: PreflightLeague[];
  failures: { leagueId: string; leagueName: string; error: string }[];
}

interface KickoffResultRow {
  leagueId: string;
  leagueName: string;
  ok: boolean;
  error?: string;
  auctionsCreated?: number;
  relegationsProcessed?: number;
}

type SectionPhase = 'loading' | 'ready' | 'confirming' | 'running' | 'done' | 'error';

export default function OffseasonAdminClient() {
  const [resetPhase, setResetPhase] = useState<SectionPhase>('loading');
  const [resetPreview, setResetPreview] = useState<ResetPreviewData | null>(null);
  const [resetResults, setResetResults] = useState<ResetResultRow[] | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const [kickoffPhase, setKickoffPhase] = useState<SectionPhase>('loading');
  const [kickoffPreview, setKickoffPreview] = useState<KickoffPreviewData | null>(null);
  const [kickoffResults, setKickoffResults] = useState<KickoffResultRow[] | null>(null);
  const [kickoffError, setKickoffError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);

  const loadResetPreview = useCallback(async () => {
    setResetPhase('loading');
    setResetError(null);
    try {
      const res = await fetch('/api/admin/offseason/reset-all');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load reset preview');
      setResetPreview(data);
      setResetPhase('ready');
    } catch (err: any) {
      setResetError(err.message);
      setResetPhase('error');
    }
  }, []);

  const loadKickoffPreview = useCallback(async () => {
    setKickoffPhase('loading');
    setKickoffError(null);
    try {
      const res = await fetch('/api/admin/offseason/kickoff-all');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load kickoff preview');
      setKickoffPreview(data);
      setKickoffPhase('ready');
    } catch (err: any) {
      setKickoffError(err.message);
      setKickoffPhase('error');
    }
  }, []);

  const loadPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      const res = await fetch('/api/admin/offseason/kickoff-preflight');
      const data = await res.json();
      // A preflight that can't be read is not a pass — leave Kickoff blocked.
      setPreflight(res.ok ? data : { ready: false, leagues: [], failures: [{ leagueId: '', leagueName: 'preflight', error: data.error ?? 'Preflight request failed' }] });
    } catch (err: any) {
      setPreflight({ ready: false, leagues: [], failures: [{ leagueId: '', leagueName: 'preflight', error: err.message }] });
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResetPreview();
    loadKickoffPreview();
    loadPreflight();
  }, [loadResetPreview, loadKickoffPreview, loadPreflight]);

  const runReset = async () => {
    setResetPhase('running');
    setResetError(null);
    try {
      const res = await fetch('/api/admin/offseason/reset-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reset failed');
      setResetResults(data.results);
      setResetPhase('done');
    } catch (err: any) {
      setResetError(err.message);
      setResetPhase('error');
    }
  };

  const runKickoff = async () => {
    setKickoffPhase('running');
    setKickoffError(null);
    try {
      const res = await fetch('/api/admin/offseason/kickoff-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Kickoff failed');
      setKickoffResults(data.results);
      setKickoffPhase('done');
    } catch (err: any) {
      setKickoffError(err.message);
      setKickoffPhase('error');
    }
  };

  const readyCount = resetPreview?.ready.length ?? 0;
  const kickoffCount = kickoffPreview?.leagues.length ?? 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Gaffa Platform Admin</p>
        <h1 className={styles.title}>Season Transition Control</h1>
        <p className={styles.subtitle}>
          Two switches that act across every league at once. <strong>Reset</strong> closes a finished season
          (prizes, standings archive) for every league that&apos;s ready. <strong>Kickoff</strong> processes
          relegation/transfer compensation and seeds summer auctions for every league still waiting in offseason.
          Neither is something league commissioners can trigger.
        </p>
      </header>

      {/* ── SEASON RESET ───────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Season Reset
          {resetPhase === 'ready' && <span className={styles.sectionBadge}>{readyCount} league(s) ready</span>}
        </h2>

        {resetPhase === 'loading' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p>Checking every league&apos;s preflight status…</p>
          </div>
        )}

        {resetPhase === 'error' && (
          <div className={styles.alertBox} data-type="error">
            <span className={styles.alertIcon}><Icon name="x" size={16} /></span>
            <span>{resetError}</span>
            <button className={styles.btnSmall} onClick={loadResetPreview}>Retry</button>
          </div>
        )}

        {(resetPhase === 'ready' || resetPhase === 'confirming') && resetPreview && (
          <>
            {resetPreview.ready.length === 0 ? (
              <p className={styles.emptyState}>No leagues are currently ready for reset.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>League</th>
                      <th>Season</th>
                      <th>Prize Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resetPreview.ready.map((l) => (
                      <tr key={l.leagueId}>
                        <td className={styles.leagueName}>{l.leagueName}</td>
                        <td>{l.seasonFrom} → {l.seasonTo}</td>
                        <td className={styles.faabAmount}>+€{l.totalPrizeFaab}m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {resetPreview.notReady.length > 0 && (
              <div className={styles.alertBox} data-type="info" style={{ marginTop: '16px' }}>
                <span className={styles.alertIcon}><Icon name="alert" size={16} /></span>
                <div>
                  <strong>{resetPreview.notReady.length} league(s) not ready:</strong>
                  <ul className={styles.issueList}>
                    {resetPreview.notReady.map((l) => (
                      <li key={l.leagueId}>{l.leagueName} — {l.issues.join('; ')}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {readyCount > 0 && resetPhase !== 'confirming' && (
              <div className={styles.actionCard} data-type="danger" style={{ marginTop: '16px' }}>
                <h2 className={styles.cardTitle}>Run Reset for {readyCount} League(s)</h2>
                <p className={styles.cardDesc}>
                  Irreversible. Archives standings, pays out prizes, clears matchups/brackets, and transitions
                  every ready league to offseason.
                </p>
                <button className={styles.btnDanger} onClick={() => setResetPhase('confirming')}>
                  I Understand — Proceed to Confirm
                </button>
              </div>
            )}

            {resetPhase === 'confirming' && (
              <div className={styles.confirmBox}>
                <p className={styles.confirmText} style={{ display: 'flex', gap: '8px' }}>
                  <Icon name="alert" size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    <strong>Are you absolutely sure?</strong> This will run end-of-season reset for all {readyCount}{' '}
                    ready league(s) right now. Cannot be undone.
                  </span>
                </p>
                <div className={styles.confirmButtons}>
                  <button className={styles.btnDanger} onClick={runReset}>Yes — Run Reset for All</button>
                  <button className={styles.btnSecondary} onClick={() => setResetPhase('ready')}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {resetPhase === 'running' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p>Running reset across all eligible leagues…</p>
          </div>
        )}

        {resetPhase === 'done' && resetResults && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr><th>League</th><th>Result</th></tr>
              </thead>
              <tbody>
                {resetResults.map((r) => (
                  <tr key={r.leagueId}>
                    <td className={styles.leagueName}>{r.leagueName}</td>
                    <td className={r.ok ? styles.statusOk : styles.statusFail}>
                      {r.ok ? `✓ Reset — +€${r.totalPrizeFaab}m paid` : `✗ Failed: ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── SEASON KICKOFF ─────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Season Kickoff
          {kickoffPhase === 'ready' && <span className={styles.sectionBadge}>{kickoffCount} league(s) waiting</span>}
        </h2>

        {kickoffPhase === 'loading' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p>Checking every offseason league…</p>
          </div>
        )}

        {kickoffPhase === 'error' && (
          <div className={styles.alertBox} data-type="error">
            <span className={styles.alertIcon}><Icon name="x" size={16} /></span>
            <span>{kickoffError}</span>
            <button className={styles.btnSmall} onClick={loadKickoffPreview}>Retry</button>
          </div>
        )}

        {(kickoffPhase === 'ready' || kickoffPhase === 'confirming') && kickoffPreview && (
          <>
            {kickoffPreview.leagues.length === 0 ? (
              <p className={styles.emptyState}>No leagues are currently waiting in offseason.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>League</th>
                      <th>Relegation Payouts</th>
                      <th>Summer Auctions Seeded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kickoffPreview.leagues.map((l) => (
                      <tr key={l.leagueId}>
                        <td className={styles.leagueName}>{l.leagueName}</td>
                        <td>
                          {l.relegationPlayers.length} player(s) —{' '}
                          <span className={styles.faabAmount}>+€{l.totalRelegationFaab.toFixed(1)}m</span>
                        </td>
                        <td>{l.summerArrivals.length} player(s)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {kickoffCount > 0 && kickoffPhase !== 'confirming' && (
              <>
                <PreflightPanel data={preflight} loading={preflightLoading} onRetry={loadPreflight} />

                <div className={styles.actionCard} data-type="danger" style={{ marginTop: '16px' }}>
                  <h2 className={styles.cardTitle}>Run Kickoff for {kickoffCount} League(s)</h2>
                  <p className={styles.cardDesc}>
                    Irreversible. Drops departed/relegated players and pays full market value into each owner&apos;s
                    Club Balance, seeds 96-hour summer auctions for high-value and promoted-club arrivals, unlocks
                    rosters, and activates every offseason league right now.
                  </p>
                  <button
                    className={styles.btnDanger}
                    disabled={preflightLoading || !preflight?.ready}
                    onClick={() => setKickoffPhase('confirming')}
                  >
                    {preflightLoading
                      ? 'Running preflight…'
                      : preflight?.ready
                        ? 'I Understand — Proceed to Confirm'
                        : 'Blocked by preflight'}
                  </button>
                </div>
              </>
            )}

            {kickoffPhase === 'confirming' && (
              <div className={styles.confirmBox}>
                <p className={styles.confirmText} style={{ display: 'flex', gap: '8px' }}>
                  <Icon name="alert" size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    <strong>Are you absolutely sure?</strong> This will kick off the new season for all{' '}
                    {kickoffCount} league(s) right now. Cannot be undone.
                  </span>
                </p>
                <div className={styles.confirmButtons}>
                  <button className={styles.btnDanger} onClick={runKickoff}>Yes — Run Kickoff for All</button>
                  <button className={styles.btnSecondary} onClick={() => setKickoffPhase('ready')}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {kickoffPhase === 'running' && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p>Running kickoff across all offseason leagues…</p>
          </div>
        )}

        {kickoffPhase === 'done' && kickoffResults && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr><th>League</th><th>Result</th></tr>
              </thead>
              <tbody>
                {kickoffResults.map((r) => (
                  <tr key={r.leagueId}>
                    <td className={styles.leagueName}>{r.leagueName}</td>
                    <td className={r.ok ? styles.statusOk : styles.statusFail}>
                      {r.ok
                        ? `✓ Kicked off — ${r.relegationsProcessed} dropped, ${r.auctionsCreated} auctions seeded`
                        : `✗ Failed: ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Kickoff's safety gate. Every check behind this panel maps to a failure that
 * actually shipped — compensation that paid nobody, auctions that failed to
 * insert, rostered players wrongly marked as departed — none of which surfaced
 * until after the irreversible run. Blockers disable the button; warnings are
 * judgement calls left to the operator.
 */
function PreflightPanel({
  data,
  loading,
  onRetry,
}: {
  data: PreflightData | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className={styles.loadingBox} style={{ marginTop: '16px' }}>
        <div className={styles.spinner} />
        <p>Running Kickoff preflight…</p>
      </div>
    );
  }

  if (!data) return null;

  const blockers = data.leagues.flatMap((l) =>
    l.issues.filter((i) => i.severity === 'blocker').map((i) => ({ league: l.leagueName, issue: i })),
  );
  const warnings = data.leagues.flatMap((l) =>
    l.issues.filter((i) => i.severity === 'warning').map((i) => ({ league: l.leagueName, issue: i })),
  );

  return (
    <div className={styles.actionCard} data-type={data.ready ? undefined : 'danger'} style={{ marginTop: '16px' }}>
      <h2 className={styles.cardTitle}>
        Preflight {data.ready ? '— all checks passed' : `— ${blockers.length} blocker(s)`}
      </h2>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr><th>League</th><th>Auctions</th><th>Departures</th><th>Compensation</th><th>Status</th></tr>
          </thead>
          <tbody>
            {data.leagues.map((l) => (
              <tr key={l.leagueId}>
                <td className={styles.leagueName}>{l.leagueName}</td>
                <td>{l.summary.auctionsToCreate}</td>
                <td>{l.summary.departuresToProcess}</td>
                <td>€{l.summary.compensationTotal}m</td>
                <td className={l.ready ? styles.statusOk : styles.statusFail}>
                  {l.ready ? '✓ ready' : '✗ blocked'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.failures.map((f) => (
        <div key={f.leagueId || f.leagueName} className={styles.alertBox} data-type="error" style={{ marginTop: '12px' }}>
          <span><strong>{f.leagueName}:</strong> preflight could not complete — {f.error}</span>
          <button className={styles.btnSmall} onClick={onRetry}>Retry</button>
        </div>
      ))}

      {blockers.map(({ league, issue }, i) => (
        <div key={`b-${i}`} className={styles.alertBox} data-type="error" style={{ marginTop: '12px' }}>
          <span>
            <strong>{league}</strong> — {issue.message}
            {issue.detail && issue.detail.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px' }}>
                {issue.detail.map((d, k) => <li key={k}>{d}</li>)}
              </ul>
            )}
          </span>
        </div>
      ))}

      {warnings.map(({ league, issue }, i) => (
        <div key={`w-${i}`} className={styles.alertBox} style={{ marginTop: '12px' }}>
          <span>
            <strong>{league}</strong> — {issue.message}
            {issue.detail && issue.detail.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px' }}>
                {issue.detail.map((d, k) => <li key={k}>{d}</li>)}
              </ul>
            )}
          </span>
        </div>
      ))}

      {data.ready && (
        <p className={styles.cardDesc} style={{ marginTop: '12px' }}>
          No blockers. Re-run after any data change — the numbers above are what Kickoff will actually do.
        </p>
      )}
      <button className={styles.btnSmall} style={{ marginTop: '12px' }} onClick={onRetry}>
        Re-run preflight
      </button>
    </div>
  );
}
