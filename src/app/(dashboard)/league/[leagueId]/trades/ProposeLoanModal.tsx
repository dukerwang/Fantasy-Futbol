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
  ppg?: number | null;
  form_rating?: number | null;
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
  totalGameweeks?: number;
  onClose: () => void;
  onProposed: (loan: any) => void;
}

const MIN_DURATION = 4;
const MAX_DURATION = 16;

export default function ProposeLoanModal({
  leagueId,
  myRoster,
  allTeams,
  currentGameweek = 1,
  loanSlotsRemaining,
  bonusCapDefault = 0,
  totalGameweeks = 38,
  onClose,
  onProposed,
}: Props) {
  // Season lock calculations
  const totalGws = totalGameweeks;
  const lastAllowedStartGw = totalGws - 8;

  // Mocking override for testing: If season is at week 38 (or >= 30), force currentGameweek to 10.
  const isMocked = currentGameweek > lastAllowedStartGw;
  const effectiveCurrentGw = isMocked ? 10 : Math.max(currentGameweek, 1);

  const [selectedPlayer, setSelectedPlayer] = useState<LoanablePlayer | null>(null);
  const [borrowerTeamId, setBorrowerTeamId] = useState<string>('');
  const [loanFee, setLoanFee] = useState<number>(0);
  const [startGameweek, setStartGameweek] = useState<number>(effectiveCurrentGw);
  const [endGameweek, setEndGameweek] = useState<number>(Math.min(effectiveCurrentGw + 6, totalGws));

  // Performance Bonus State
  const [bonusRate, setBonusRate] = useState<number>(0);
  const [bonusMode, setBonusMode] = useState<'none' | 'low' | 'med' | 'high' | 'custom'>('none');

  const [hasRecall, setHasRecall] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duration = endGameweek - startGameweek;

  // 1. Dynamic Economic Anchors (High Value Tier)
  const baseWeeklyValue = useMemo(() => {
    if (!selectedPlayer) return 1.0;
    if (selectedPlayer.ppg && selectedPlayer.ppg > 0) {
      return selectedPlayer.ppg * 0.08;
    }
    if (selectedPlayer.market_value && selectedPlayer.market_value > 0) {
      return selectedPlayer.market_value * 0.008;
    }
    return 1.0; // absolute fallback
  }, [selectedPlayer]);

  // Compute points-based rate tiers dynamically
  const bonusLevels = useMemo(() => {
    if (!selectedPlayer) return { low: 0.01, med: 0.02, high: 0.03 };
    const ppg = selectedPlayer.ppg || 8;
    return {
      low: parseFloat(Math.max(0.01, (baseWeeklyValue * 0.2) / ppg).toFixed(2)),
      med: parseFloat(Math.max(0.02, (baseWeeklyValue * 0.4) / ppg).toFixed(2)),
      high: parseFloat(Math.max(0.03, (baseWeeklyValue * 0.6) / ppg).toFixed(2)),
    };
  }, [selectedPlayer, baseWeeklyValue]);

  // 2. Preset Deal Templates
  const presetDeals = useMemo(() => {
    if (!selectedPlayer) return [];
    const stdTotal = baseWeeklyValue * duration;
    return [
      {
        id: 'fixed',
        name: '💼 Fixed',
        fee: Math.round(stdTotal),
        rate: 0,
        mode: 'none' as const,
        desc: 'Single upfront fee. No performance tracking or bonus payouts.',
      },
      {
        id: 'hybrid',
        name: '🤝 Balanced',
        fee: Math.round(stdTotal * 0.6),
        rate: bonusLevels.med,
        mode: 'med' as const,
        desc: 'Moderate upfront fee. Splits risk between upfront and points scored.',
      },
      {
        id: 'performance',
        name: '🚀 Performance Heavy',
        // Clamp to €1m to ensure cap (3x fee) is at least €3m, satisfying league constraints
        fee: Math.max(1, Math.round(stdTotal * 0.2)),
        rate: bonusLevels.high,
        mode: 'high' as const,
        desc: 'Low upfront fee. You pay based on actual player scoring.',
      },
    ];
  }, [selectedPlayer, baseWeeklyValue, duration, bonusLevels]);

  const [activePreset, setActivePreset] = useState<string | null>(null);

  const applyPreset = (preset: typeof presetDeals[0]) => {
    setLoanFee(preset.fee);
    setBonusRate(preset.rate);
    setBonusMode(preset.mode);
    setActivePreset(preset.id);
  };

  const handleBonusModeChange = (mode: typeof bonusMode) => {
    setBonusMode(mode);
    if (mode === 'none') {
      setBonusRate(0);
    } else if (mode === 'low') {
      setBonusRate(bonusLevels.low);
    } else if (mode === 'med') {
      setBonusRate(bonusLevels.med);
    } else if (mode === 'high') {
      setBonusRate(bonusLevels.high);
    }
  };

  // Sync start GW default when effectiveCurrentGw changes
  useEffect(() => {
    setStartGameweek(effectiveCurrentGw);
    setEndGameweek(Math.min(effectiveCurrentGw + 6, totalGws));
  }, [effectiveCurrentGw, totalGws]);

  // Default initial presets on player selection
  useEffect(() => {
    if (selectedPlayer) {
      const stdTotal = baseWeeklyValue * 6; // default 6 GW duration
      setLoanFee(Math.round(stdTotal * 0.6)); // default to balanced
      setBonusRate(bonusLevels.med);
      setBonusMode('med');
      setActivePreset('hybrid');
    } else {
      setLoanFee(0);
      setBonusRate(0);
      setBonusMode('none');
      setActivePreset(null);
    }
  }, [selectedPlayer, baseWeeklyValue, bonusLevels]);

  const eligiblePlayers = myRoster.filter(
    (p) => !['ir', 'taxi', 'loan_in', 'loan_out'].includes(p.status)
  );

  const previewBonusCap = useMemo(() => {
    if (bonusRate <= 0) return 0;
    if (bonusCapDefault > 0) return bonusCapDefault;
    return loanFee * 3;
  }, [bonusRate, bonusCapDefault, loanFee]);

  const maxPossibleCost = loanFee + previewBonusCap;

  // Real-time Payout Estimations
  const estPoints = Math.round(duration * (selectedPlayer?.ppg || 0));
  const estBonusPayout = Math.min(previewBonusCap, estPoints * bonusRate);

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
    border: '1px solid var(--color-border)',
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
            {isMocked && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(245,158,11,0.15)', color: '#d97706', padding: '2px 8px', borderRadius: '10px', fontSize: '9px', fontWeight: 600, marginTop: '4px' }}>
                ⚠️ preview mode: season at GW{currentGameweek} (mocked to GW10 for testing sliders)
              </div>
            )}
            {loanSlotsRemaining !== undefined && !selectedPlayer && (
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
          <form onSubmit={handleProposeLoan} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>

            {/* Selected Player Card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-bg-elevated)', padding: '14px 16px', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-accent-blue)', borderTop: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
              <PositionBadge position={selectedPlayer.primary_position as any} size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {formatPlayerName(selectedPlayer, 'full')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                  {selectedPlayer.pl_team ?? ''}
                  {selectedPlayer.market_value ? ` · €${selectedPlayer.market_value.toFixed(1)}m market value` : ''}
                  {selectedPlayer.ppg ? ` · ${selectedPlayer.ppg.toFixed(1)} PPG` : ''}
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

            {/* GW Range slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Loan Period</label>
              <GwRangeSlider
                min={effectiveCurrentGw}
                maxStart={lastAllowedStartGw}
                maxEnd={totalGws}
                startGw={startGameweek}
                endGw={endGameweek}
                minDuration={MIN_DURATION}
                maxDuration={MAX_DURATION}
                onChange={(s, e) => {
                  setStartGameweek(s);
                  setEndGameweek(e);
                  setActivePreset(null); // break preset
                }}
              />
            </div>

            {/* Preset Templates */}
            <div>
              <label style={labelStyle}>Quick Deal Templates</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginTop: '6px' }}>
                {presetDeals.map((preset) => {
                  const isActive = activePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      style={{
                        padding: '10px',
                        borderRadius: 'var(--radius-sm)',
                        border: isActive ? '2px solid var(--color-accent-blue)' : '1px solid var(--color-border)',
                        background: isActive ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-elevated)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '11px', fontWeight: 700, color: isActive ? 'var(--color-accent-blue)' : 'var(--color-text-primary)' }}>
                        {preset.name}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                        Fee: €{preset.fee}m {preset.rate > 0 ? `+ €${preset.rate}m/pt` : '(Fixed)'}
                      </span>
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', lineHeight: '1.2' }}>
                        {preset.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Loan Fee slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Loan Fee (paid by borrower on acceptance)</label>
              <LoanFeeSlider
                value={loanFee}
                ppg={selectedPlayer.ppg}
                marketValue={selectedPlayer.market_value}
                duration={duration}
                onChange={(val) => {
                  setLoanFee(val);
                  setActivePreset(null); // break preset
                }}
              />
            </div>

            {/* Performance Bonus */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Performance Payout (€m per fantasy point)</label>
              
              {/* Segmented control */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {(['none', 'low', 'med', 'high', 'custom'] as const).map((mode) => {
                  const isActive = bonusMode === mode;
                  const labelMap = {
                    none: 'None',
                    low: `Low (€${bonusLevels.low}/pt)`,
                    med: `Mid (€${bonusLevels.med}/pt)`,
                    high: `High (€${bonusLevels.high}/pt)`,
                    custom: 'Custom',
                  };
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleBonusModeChange(mode)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '16px',
                        border: '1px solid var(--color-border)',
                        background: isActive ? 'var(--color-accent-blue)' : 'var(--color-bg-card)',
                        color: isActive ? '#fff' : 'var(--color-text-secondary)',
                        fontSize: '10px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.1s ease',
                      }}
                    >
                      {labelMap[mode]}
                    </button>
                  );
                })}
              </div>

              {bonusMode === 'custom' && (
                <div style={{ marginBottom: '10px' }}>
                  <input
                    type="number" min="0" step="0.01" style={inputStyle}
                    value={bonusRate}
                    onChange={(e) => {
                      setBonusRate(Math.max(0, parseFloat(e.target.value) || 0));
                      setActivePreset(null);
                    }}
                    placeholder="Enter rate (€m / pt)"
                  />
                </div>
              )}

              {bonusRate > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px', background: 'rgba(99,135,255,0.06)', borderRadius: '4px', fontSize: '11px', color: 'var(--color-text-secondary)', borderLeft: '3px solid var(--color-accent-blue)' }}>
                  <div>
                    Bonus Rate: <strong>€{bonusRate}m / fantasy point</strong>
                  </div>
                  <div>
                    Bonus Cap: <strong>€{previewBonusCap}m</strong>
                    {bonusCapDefault > 0 ? ' (league flat cap)' : ` (3× loan fee)`}
                  </div>
                  {selectedPlayer?.ppg && selectedPlayer.ppg > 0 && (
                    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '4px', paddingTop: '4px', color: 'var(--color-text-muted)' }}>
                      📈 Expected points: <strong>~{estPoints} pts</strong> over {duration} GWs
                      <br />
                      💰 Expected bonus cost: <strong>€{estBonusPayout.toFixed(1)}m</strong>
                    </div>
                  )}
                  {loanFee === 0 && bonusCapDefault === 0 && (
                    <span style={{ color: 'var(--color-accent-red)', display: 'block', marginTop: '2px', fontWeight: 600 }}>
                      ⚠ Set a loan fee ≥ €1m to enable performance bonuses.
                    </span>
                  )}
                </div>
              )}

              {bonusRate === 0 && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  Borrower pays only the upfront fee. No point-based bonuses.
                </span>
              )}
            </div>

            {/* Recall Clause */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
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
                {bonusRate > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Est. performance bonus (Expected total)</span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      €{estBonusPayout.toFixed(1)}m <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>(Max €{previewBonusCap}m)</span>
                    </span>
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
