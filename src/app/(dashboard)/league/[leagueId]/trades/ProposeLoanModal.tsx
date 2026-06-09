'use client';

import { useState, useEffect, useMemo } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import LoanFeeSlider from './LoanFeeSlider';
import GwRangeSlider from './GwRangeSlider';
import styles from './trades.module.css';

export interface LoanablePlayer {
  id: string;
  name: string;
  web_name: string | null;
  pl_team?: string | null;
  market_value?: number | null;
  primary_position: string;
  status: string;
}

interface Team {
  id: string;
  team_name: string;
}

interface Props {
  leagueId: string;
  myRoster: LoanablePlayer[];
  allTeams: Team[];
  currentGameweek?: number;
  loanSlotsRemaining?: number;
  bonusCapDefault?: number;
  onClose: () => void;
  onProposed: (loan: any) => void;
}

const LAST_ALLOWED_START_GW = 30;
const MIN_DURATION = 4;
const MAX_DURATION = 16;

export default function ProposeLoanModal({
  leagueId,
  myRoster,
  allTeams,
  currentGameweek = 1,
  loanSlotsRemaining,
  bonusCapDefault = 0,
  onClose,
  onProposed,
}: Props) {
  const [selectedPlayer, setSelectedPlayer] = useState<LoanablePlayer | null>(null);
  const [borrowerTeamId, setBorrowerTeamId] = useState<string>('');
  const [loanFee, setLoanFee] = useState<number>(0);
  const [startGameweek, setStartGameweek] = useState<number>(currentGameweek);
  const [endGameweek, setEndGameweek] = useState<number>(Math.min(currentGameweek + 6, 38));
  const [bonusRate, setBonusRate] = useState<number>(0);
  const [hasRecall, setHasRecall] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart default: ~8% of market value when player is selected
  useEffect(() => {
    if (selectedPlayer?.market_value && selectedPlayer.market_value > 0) {
      setLoanFee(Math.max(1, Math.round(selectedPlayer.market_value * 0.08)));
    } else {
      setLoanFee(0);
    }
  }, [selectedPlayer]);

  // Sync start GW default when currentGameweek prop changes
  useEffect(() => {
    setStartGameweek(Math.max(currentGameweek, 1));
    setEndGameweek(Math.min(Math.max(currentGameweek, 1) + 6, 38));
  }, [currentGameweek]);

  const eligiblePlayers = myRoster.filter(
    (p) => !['ir', 'taxi', 'loan_in', 'loan_out'].includes(p.status)
  );

  const duration = endGameweek - startGameweek;

  const previewBonusCap = useMemo(() => {
    if (bonusRate <= 0) return 0;
    if (bonusCapDefault > 0) return bonusCapDefault;
    return loanFee * 3;
  }, [bonusRate, bonusCapDefault, loanFee]);

  const maxPossibleCost = loanFee + previewBonusCap;

  async function handleProposeLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlayer || !borrowerTeamId) {
      setError('Please select a borrower club.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrowerTeamId,
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
        onProposed(data.loan);
        onClose();
      } else {
        setError(data.error ?? 'Failed to propose loan.');
      }
    } catch (err) {
      console.error(err);
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

  const sectionStyle = {
    background: 'var(--color-bg-elevated)',
    borderRadius: 'var(--radius-sm)',
    padding: '16px',
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalLabel}>PLAYER LOANS</span>
            <h2 className={styles.modalTitle}>
              {selectedPlayer ? 'Set Loan Terms' : 'Select Player to Loan Out'}
            </h2>
            {loanSlotsRemaining !== undefined && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: loanSlotsRemaining > 0 ? 'var(--color-text-muted)' : 'var(--color-accent-red)' }}>
                {loanSlotsRemaining > 0
                  ? `${loanSlotsRemaining} loan-out slot${loanSlotsRemaining !== 1 ? 's' : ''} remaining`
                  : 'No loan-out slots remaining'}
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

        {/* ── Step 1: Player selection ── */}
        {!selectedPlayer ? (
          <>
            <p className={styles.modalHint}>
              Select an active roster player to loan out to another club.
            </p>
            {eligiblePlayers.length === 0 ? (
              <p className={styles.modalEmpty}>No active roster players are eligible to be loaned out.</p>
            ) : (
              <div className={styles.blockToggleList}>
                {eligiblePlayers.map((p) => (
                  <div
                    key={p.id}
                    className={styles.blockToggleRow}
                    onClick={() => setSelectedPlayer(p)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.blockToggleLeft}>
                      <PositionBadge position={p.primary_position as any} size="sm" />
                      <div className={styles.blockToggleInfo}>
                        <span className={styles.blockToggleName}>{formatPlayerName(p, 'initial_last')}</span>
                        <span className={styles.blockToggleClub}>
                          {p.pl_team ?? ''}
                          {p.market_value ? ` · €${p.market_value.toFixed(1)}m` : ''}
                        </span>
                      </div>
                    </div>
                    <div className={styles.blockToggleRight}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Select →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Step 2: Loan terms ── */
          <form onSubmit={handleProposeLoan} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '75vh', overflowY: 'auto' }}>

            {/* Selected Player Card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-bg-elevated)', padding: '14px 16px', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-accent-blue)' }}>
              <PositionBadge position={selectedPlayer.primary_position as any} size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {formatPlayerName(selectedPlayer, 'full')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                  {selectedPlayer.pl_team ?? ''}
                  {selectedPlayer.market_value ? ` · €${selectedPlayer.market_value.toFixed(1)}m market value` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '11px', textDecoration: 'underline' }}
              >
                Change
              </button>
            </div>

            {/* Borrower Selection */}
            <div>
              <label style={labelStyle}>Borrowing Club</label>
              <select required value={borrowerTeamId} onChange={(e) => setBorrowerTeamId(e.target.value)} style={inputStyle}>
                <option value="">— Select borrower —</option>
                {allTeams.map((t) => (
                  <option key={t.id} value={t.id}>{t.team_name}</option>
                ))}
              </select>
            </div>

            {/* Loan Fee slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Loan Fee (paid by borrower on acceptance)</label>
              <LoanFeeSlider
                value={loanFee}
                marketValue={selectedPlayer.market_value}
                onChange={setLoanFee}
              />
            </div>

            {/* GW Range slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Loan Period</label>
              <GwRangeSlider
                min={currentGameweek}
                maxStart={LAST_ALLOWED_START_GW}
                maxEnd={38}
                startGw={startGameweek}
                endGw={endGameweek}
                minDuration={MIN_DURATION}
                maxDuration={MAX_DURATION}
                onChange={(s, e) => { setStartGameweek(s); setEndGameweek(e); }}
              />
            </div>

            {/* Performance Bonus */}
            <div>
              <label style={labelStyle}>Performance Bonus (€m per fantasy point)</label>
              <input
                type="number" min="0" step="0.01" style={inputStyle}
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
              {bonusRate === 0 && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>
                  Set to 0 for no performance bonus.
                </span>
              )}
            </div>

            {/* Recall Clause */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
              <input
                type="checkbox" id="hasRecall"
                checked={hasRecall} onChange={(e) => setHasRecall(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '1px', flexShrink: 0 }}
              />
              <div>
                <label htmlFor="hasRecall" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                  Include Early Recall Clause
                </label>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                  You can cancel the loan early by paying MAX(€25m, loan fee) back to the borrower.
                </p>
              </div>
            </div>

            {/* Cost Summary */}
            <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-green)', marginBottom: '10px' }}>
                Cost Summary
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Loan fee (upfront)</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {loanFee > 0 ? `€${loanFee}m` : 'Free'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Period</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    GW{startGameweek}–GW{endGameweek} ({duration} GW{duration !== 1 ? 's' : ''})
                  </span>
                </div>
                {bonusRate > 0 && previewBonusCap > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Max performance bonus</span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>€{previewBonusCap}m</span>
                  </div>
                )}
                <div style={{ borderTop: '1px solid rgba(16,185,129,0.18)', marginTop: '4px', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>Borrower pays at most</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-accent-green)', fontSize: '15px' }}>
                    €{maxPossibleCost}m
                  </span>
                </div>
              </div>
            </div>

            {/* Message */}
            <div>
              <label style={labelStyle}>Negotiation Note (optional)</label>
              <textarea
                value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a note to your loan proposal…"
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button type="button" className={styles.blockToggleBtn} onClick={() => setSelectedPlayer(null)} disabled={submitting}>
                Back
              </button>
              <button
                type="submit"
                className={styles.blockToggleBtn}
                style={{ background: 'var(--color-accent-green)', borderColor: 'var(--color-accent-green)', color: '#fff' }}
                disabled={submitting}
              >
                {submitting ? 'Proposing…' : 'Propose Loan'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
