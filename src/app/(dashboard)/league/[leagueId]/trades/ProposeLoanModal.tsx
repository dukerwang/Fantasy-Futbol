'use client';

import { useState, useEffect } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
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
  onClose: () => void;
  onProposed: (loan: any) => void;
}

export default function ProposeLoanModal({
  leagueId,
  myRoster,
  allTeams,
  onClose,
  onProposed,
}: Props) {
  const [selectedPlayer, setSelectedPlayer] = useState<LoanablePlayer | null>(null);
  const [borrowerTeamId, setBorrowerTeamId] = useState<string>('');
  const [loanFee, setLoanFee] = useState<number>(0);
  const [startGameweek, setStartGameweek] = useState<number>(1);
  const [endGameweek, setEndGameweek] = useState<number>(5);
  const [bonusRate, setBonusRate] = useState<number>(0);
  const [hasRecall, setHasRecall] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter roster for loan-eligible players: status NOT IN ('ir', 'taxi', 'loan_in', 'loan_out')
  const eligiblePlayers = myRoster.filter(
    (p) => !['ir', 'taxi', 'loan_in', 'loan_out'].includes(p.status)
  );

  // Auto-adjust end gameweek options when start gameweek changes
  useEffect(() => {
    if (endGameweek < startGameweek + 4 || endGameweek > startGameweek + 16) {
      setEndGameweek(startGameweek + 4);
    }
  }, [startGameweek, endGameweek]);

  // Generate valid start gameweek options (up to GW30 since final 8 GWs are locked)
  const startGwOptions = Array.from({ length: 30 }, (_, i) => i + 1);

  // Generate valid end gameweek options (duration 4 to 16, max 38)
  const endGwOptions = Array.from({ length: 13 }, (_, i) => startGameweek + 4 + i).filter(
    (gw) => gw <= 38
  );

  async function handleProposeLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlayer) return;
    if (!borrowerTeamId) {
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

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalLabel}>PLAYER LOANS</span>
            <h2 className={styles.modalTitle}>
              {selectedPlayer ? 'Propose Loan Terms' : 'Select Player to Loan Out'}
            </h2>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && (
          <div className={styles.modalHint} style={{ color: 'var(--color-accent-red)', borderBottom: 'none' }}>
            {error}
          </div>
        )}

        {!selectedPlayer ? (
          <>
            <p className={styles.modalHint}>
              Select an active roster player to make available for temporary loan.
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
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        Select Player
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleProposeLoan} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
            {/* Player details card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)' }}>
              <PositionBadge position={selectedPlayer.primary_position as any} size="md" />
              <div>
                <h3 style={{ margin: 0, fontFamily: 'Noto Serif, serif', fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {formatPlayerName(selectedPlayer, 'full')}
                </h3>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {selectedPlayer.pl_team ?? ''} {selectedPlayer.market_value ? `· €${selectedPlayer.market_value.toFixed(1)}m MV` : ''}
                </span>
              </div>
            </div>

            {/* Borrower Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Borrower Club
              </label>
              <select
                required
                value={borrowerTeamId}
                onChange={(e) => setBorrowerTeamId(e.target.value)}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-primary)',
                  fontSize: '14px',
                }}
              >
                <option value="">-- Select Team --</option>
                {allTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.team_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Loan Fee */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Loan Fee (€m)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={loanFee}
                onChange={(e) => setLoanFee(Math.max(0, parseInt(e.target.value, 10) || 0))}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-primary)',
                  fontSize: '14px',
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                Deducted from borrower and credited to lender upon acceptance. Can be €0.
              </span>
            </div>

            {/* GW selector group */}
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                  Start Gameweek
                </label>
                <select
                  value={startGameweek}
                  onChange={(e) => setStartGameweek(parseInt(e.target.value, 10))}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-card)',
                    color: 'var(--color-text-primary)',
                    fontSize: '14px',
                  }}
                >
                  {startGwOptions.map((gw) => (
                    <option key={gw} value={gw}>
                      GW {gw}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                  End Gameweek
                </label>
                <select
                  value={endGameweek}
                  onChange={(e) => setEndGameweek(parseInt(e.target.value, 10))}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-card)',
                    color: 'var(--color-text-primary)',
                    fontSize: '14px',
                  }}
                >
                  {endGwOptions.map((gw) => (
                    <option key={gw} value={gw}>
                      GW {gw}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '-8px' }}>
              Duration must be between 4 and 16 gameweeks (GW {startGameweek} to GW {endGameweek} = {endGameweek - startGameweek} GWs).
            </span>

            {/* Performance Bonus Clause */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Performance Bonus (€m per fantasy point)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={bonusRate}
                onChange={(e) => setBonusRate(Math.max(0, parseFloat(e.target.value) || 0))}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-primary)',
                  fontSize: '14px',
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                Paid by borrower to lender at loan end based on total fantasy points scored. Capped at 3x loan fee (or default cap).
              </span>
            </div>

            {/* Recall Clause */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="hasRecall"
                checked={hasRecall}
                onChange={(e) => setHasRecall(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="hasRecall" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                Include Early Recall Rights
              </label>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '-12px' }}>
              Allows lender to recall the player early by paying a penalty = MAX(€25m, loan fee).
            </span>

            {/* Notes/Message */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Negotiation Message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional negotiation note..."
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-primary)',
                  fontSize: '14px',
                  minHeight: '60px',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                type="button"
                className={styles.blockToggleBtn}
                onClick={() => setSelectedPlayer(null)}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="submit"
                className={styles.blockToggleBtn}
                style={{ background: 'var(--color-accent-green)', borderColor: 'var(--color-accent-green)', color: '#fff' }}
                disabled={submitting}
              >
                {submitting ? 'Proposing Loan…' : 'Propose Loan'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
