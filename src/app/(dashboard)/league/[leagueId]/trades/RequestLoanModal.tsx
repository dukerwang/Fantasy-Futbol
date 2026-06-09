'use client';

import { useState, useMemo } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import styles from './trades.module.css';

interface SimplePlayer {
  id: string;
  name: string;
  web_name: string | null;
  full_name?: string | null;
  pl_team?: string | null;
  market_value?: number | null;
  primary_position: string;
  status?: string;
}

interface Team {
  id: string;
  team_name: string;
}

interface Props {
  leagueId: string;
  allTeams: Team[];
  allRosters: Record<string, SimplePlayer[]>;
  currentGameweek?: number;
  loanSlotsRemaining?: number;
  bonusCapDefault?: number;
  onClose: () => void;
  onRequested: (loan: any) => void;
}

export default function RequestLoanModal({
  leagueId,
  allTeams,
  allRosters,
  currentGameweek = 1,
  loanSlotsRemaining,
  bonusCapDefault = 0,
  onClose,
  onRequested,
}: Props) {
  // Step 1: pick team + player. Step 2: set terms.
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<SimplePlayer | null>(null);

  // Loan terms
  const [loanFee, setLoanFee] = useState(0);
  const [startGameweek, setStartGameweek] = useState(currentGameweek);
  const [endGameweek, setEndGameweek] = useState(Math.min(currentGameweek + 6, 38));
  const [bonusRate, setBonusRate] = useState(0);
  const [hasRecall, setHasRecall] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamRoster: SimplePlayer[] = selectedTeamId ? (allRosters[selectedTeamId] ?? []) : [];
  // Only show players eligible to be loaned out (not already on IR, taxi, or loaned)
  const eligibleRoster = teamRoster.filter(
    (p) => !p.status || !['ir', 'taxi', 'loan_in', 'loan_out'].includes(p.status)
  );

  const lastAllowedStartGw = 30;
  const startGwOptions = useMemo(() =>
    Array.from({ length: Math.max(0, lastAllowedStartGw - currentGameweek + 1) }, (_, i) => currentGameweek + i),
    [currentGameweek]
  );
  const endGwOptions = useMemo(() =>
    Array.from({ length: 13 }, (_, i) => startGameweek + 4 + i).filter((gw) => gw <= 38),
    [startGameweek]
  );
  const duration = endGameweek - startGameweek;

  const previewBonusCap = useMemo(() => {
    if (bonusRate <= 0) return 0;
    if (bonusCapDefault > 0) return bonusCapDefault;
    return loanFee * 3;
  }, [bonusRate, bonusCapDefault, loanFee]);

  function handleSelectPlayer(p: SimplePlayer) {
    setSelectedPlayer(p);
    setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlayer || !selectedTeamId) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestMode: true,
          lenderTeamId: selectedTeamId,
          playerId: selectedPlayer.id,
          loanFee,
          startGameweek,
          endGameweek,
          bonusRate,
          hasRecall,
          message: message || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onRequested(data.loan);
        onClose();
      } else {
        setError(data.error ?? 'Failed to submit loan request.');
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-card)',
    color: 'var(--color-text-primary)',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box' as const,
  };

  const labelStyle = {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--color-text-secondary)',
    marginBottom: '6px',
    display: 'block',
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalLabel}>PLAYER LOANS</span>
            <h2 className={styles.modalTitle}>
              {step === 1 ? 'Request a Loan' : 'Propose Terms'}
            </h2>
            {loanSlotsRemaining !== undefined && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: loanSlotsRemaining > 0 ? 'var(--color-text-muted)' : 'var(--color-accent-red)' }}>
                {loanSlotsRemaining > 0
                  ? `${loanSlotsRemaining} loan-in slot${loanSlotsRemaining !== 1 ? 's' : ''} remaining`
                  : 'No loan-in slots remaining'}
              </p>
            )}
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && (
          <div className={styles.modalHint} style={{ color: 'var(--color-accent-red)', borderBottom: 'none' }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Pick team & player ── */}
        {step === 1 && (
          <>
            <p className={styles.modalHint}>
              Select the club and player you want to request a loan from. They will receive your proposed terms and can accept or negotiate.
            </p>

            {/* Team picker */}
            <div style={{ padding: '16px 24px 0' }}>
              <label style={labelStyle}>Club to request from</label>
              <select
                value={selectedTeamId}
                onChange={(e) => { setSelectedTeamId(e.target.value); setSelectedPlayer(null); }}
                style={inputStyle}
              >
                <option value="">— Select a club —</option>
                {allTeams.map((t) => (
                  <option key={t.id} value={t.id}>{t.team_name}</option>
                ))}
              </select>
            </div>

            {/* Roster list */}
            {selectedTeamId && (
              eligibleRoster.length === 0 ? (
                <p className={styles.modalEmpty}>No loanable players on that club&apos;s roster.</p>
              ) : (
                <div className={styles.blockToggleList} style={{ marginTop: '12px' }}>
                  {eligibleRoster.map((p) => (
                    <div
                      key={p.id}
                      className={styles.blockToggleRow}
                      onClick={() => handleSelectPlayer(p)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className={styles.blockToggleLeft}>
                        <PositionBadge position={p.primary_position as any} size="sm" />
                        <div className={styles.blockToggleInfo}>
                          <span className={styles.blockToggleName}>
                            {formatPlayerName(p, 'initial_last')}
                          </span>
                          <span className={styles.blockToggleClub}>
                            {p.pl_team ?? ''}
                            {p.market_value ? ` · €${p.market_value.toFixed(1)}m` : ''}
                          </span>
                        </div>
                      </div>
                      <div className={styles.blockToggleRight}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Request →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}

        {/* ── Step 2: Set terms ── */}
        {step === 2 && selectedPlayer && (
          <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflowY: 'auto' }}>

            {/* Selected Player Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-bg-elevated)', padding: '14px 16px', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-accent-green)' }}>
              <PositionBadge position={selectedPlayer.primary_position as any} size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {formatPlayerName(selectedPlayer, 'full')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                  {allTeams.find(t => t.id === selectedTeamId)?.team_name} · {selectedPlayer.pl_team ?? ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedPlayer(null); setStep(1); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '11px', textDecoration: 'underline' }}
              >
                Change
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: 'rgba(99,200,99,0.08)', borderLeft: '3px solid var(--color-accent-green)', borderRadius: '4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              These are your <strong>proposed terms</strong>. The other manager will need to accept before the loan is active.
            </div>

            {/* Loan Fee you're willing to pay */}
            <div>
              <label style={labelStyle}>Loan Fee you&apos;re offering (€m)</label>
              <input
                type="number" min="0" step="1" required style={inputStyle}
                value={loanFee}
                onChange={(e) => setLoanFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>
                You pay this to their club upon acceptance. Set to €0 for a free loan.
              </span>
            </div>

            {/* Gameweek Range */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Start Gameweek</label>
                <select value={startGameweek} onChange={(e) => setStartGameweek(parseInt(e.target.value, 10))} style={inputStyle}>
                  {startGwOptions.length === 0
                    ? <option value={currentGameweek}>GW {currentGameweek}</option>
                    : startGwOptions.map((gw) => <option key={gw} value={gw}>GW {gw}</option>)
                  }
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>End Gameweek</label>
                <select value={endGameweek} onChange={(e) => setEndGameweek(parseInt(e.target.value, 10))} style={inputStyle}>
                  {endGwOptions.map((gw) => <option key={gw} value={gw}>GW {gw}</option>)}
                </select>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '-8px' }}>
              Duration: <strong>{duration} gameweek{duration !== 1 ? 's' : ''}</strong> (GW{startGameweek}–GW{endGameweek})
            </span>

            {/* Performance Bonus */}
            <div>
              <label style={labelStyle}>Performance Bonus you&apos;re offering (€m / fantasy point)</label>
              <input
                type="number" min="0" step="0.01" required style={inputStyle}
                value={bonusRate}
                onChange={(e) => setBonusRate(Math.max(0, parseFloat(e.target.value) || 0))}
              />
              {bonusRate > 0 && (
                <div style={{ marginTop: '6px', padding: '8px 10px', background: 'rgba(99,135,255,0.08)', borderRadius: '4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  Bonus cap: <strong>€{previewBonusCap}m</strong>
                  {bonusCapDefault > 0 ? ' (league flat cap)' : ` (3× loan fee)`}
                  {loanFee === 0 && bonusCapDefault === 0 && (
                    <span style={{ color: 'var(--color-accent-red)', display: 'block', marginTop: '2px' }}>
                      ⚠ Set a loan fee ≥ €1m to enable performance bonuses.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Recall Clause */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
              <input
                type="checkbox" id="hasRecallReq"
                checked={hasRecall} onChange={(e) => setHasRecall(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '1px', flexShrink: 0 }}
              />
              <div>
                <label htmlFor="hasRecallReq" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                  Request Early Recall Rights for lender
                </label>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  Grants the lending club the right to recall the player early. They pay MAX(€25m, loan fee) penalty to you.
                </p>
              </div>
            </div>

            {/* Message */}
            <div>
              <label style={labelStyle}>Message (optional)</label>
              <textarea
                value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a note to your loan request…"
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button type="button" className={styles.blockToggleBtn} onClick={() => setStep(1)} disabled={submitting}>
                Back
              </button>
              <button
                type="submit"
                className={styles.blockToggleBtn}
                style={{ background: 'var(--color-accent-blue)', borderColor: 'var(--color-accent-blue)', color: '#fff' }}
                disabled={submitting}
              >
                {submitting ? 'Sending Request…' : 'Send Loan Request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
