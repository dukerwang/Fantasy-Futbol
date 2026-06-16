'use client';

import { useState, useEffect, useMemo } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import GwRangeSlider from './GwRangeSlider';
import styles from './trades.module.css';

interface SimplePlayer {
  id: string;
  name: string;
  web_name: string | null;
  full_name?: string | null;
  pl_team?: string | null;
  market_value?: number | null;
  ppg?: number | null;
  form_rating?: number | null;
  primary_position: string;
  status?: string;
  recent_ppg?: number | null;
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
  totalGameweeks?: number;
  onClose: () => void;
  onRequested: (loan: any) => void;
}

const MIN_DURATION = 4;
const MAX_DURATION = 16;

export default function RequestLoanModal({
  leagueId,
  allTeams,
  allRosters,
  currentGameweek = 1,
  loanSlotsRemaining,
  totalGameweeks = 38,
  onClose,
  onRequested,
}: Props) {
  // Season lock calculations
  const totalGws = totalGameweeks;
  const lastAllowedStartGw = totalGws - 8;

  // Mocking override for testing: If season is at week 38 (or >= 30), force currentGameweek to 10.
  const isMocked = currentGameweek > lastAllowedStartGw;
  const effectiveCurrentGw = isMocked ? 10 : Math.max(currentGameweek, 1);

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<SimplePlayer | null>(null);

  // Period Selection
  const [startGameweek, setStartGameweek] = useState(effectiveCurrentGw);
  const [endGameweek, setEndGameweek] = useState(Math.min(effectiveCurrentGw + 6, totalGws));
  const duration = endGameweek - startGameweek;

  // Template & Adjustment State
  const [selectedTemplate, setSelectedTemplate] = useState<'fixed' | 'balanced' | 'performance'>('balanced');
  const [adjustment, setAdjustment] = useState<number>(0); // ranges from -0.20 to +0.20
  const [hasRecall, setHasRecall] = useState<boolean>(true);

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync start GW default when effectiveCurrentGw changes
  useEffect(() => {
    setStartGameweek(effectiveCurrentGw);
    setEndGameweek(Math.min(effectiveCurrentGw + 6, totalGws));
  }, [effectiveCurrentGw, totalGws]);

  // Reset adjustment when duration or player changes
  useEffect(() => {
    setAdjustment(0);
  }, [selectedPlayer, duration]);

  const teamRoster: SimplePlayer[] = selectedTeamId ? (allRosters[selectedTeamId] ?? []) : [];
  const eligibleRoster = teamRoster.filter(
    (p) => !p.status || !['ir', 'taxi', 'loan_in', 'loan_out'].includes(p.status)
  );

  function handleSelectPlayer(p: SimplePlayer) {
    setSelectedPlayer(p);
    setStep(2);
  }

  // ─── Loan Calculations ───────────────────────────────────────────────────
  
  // recentPPG = average fantasy points over last 10 GWs, floored at 3.
  const recentPPG = useMemo(() => {
    if (!selectedPlayer) return 3.0;
    const statsPPG = selectedPlayer.recent_ppg ?? selectedPlayer.ppg ?? 3.0;
    return Math.max(3.0, statsPPG);
  }, [selectedPlayer]);

  // baseFee = round(0.5 × sqrt(recentPPG) × loanWeeks)
  const baseFee = useMemo(() => {
    if (!selectedPlayer) return 0;
    return Math.round(0.5 * Math.sqrt(recentPPG) * duration);
  }, [selectedPlayer, recentPPG, duration]);

  // Compute template terms based on baseFee and formula rules
  const templateTerms = useMemo(() => {
    if (!selectedPlayer) return { fixed: { fee: 0, rate: 0, cap: 0 }, balanced: { fee: 0, rate: 0, cap: 0 }, performance: { fee: 0, rate: 0, cap: 0 } };
    
    // Fixed: fee = baseFee, no bonus
    const fixedFee = baseFee;
    
    // Balanced: fee = baseFee × 0.55, bonusRate = (baseFee × 0.45) / (recentPPG × loanWeeks)
    const balancedFee = baseFee * 0.55;
    const balancedRate = (baseFee * 0.45) / (recentPPG * duration);
    const balancedCap = 2 * (baseFee - balancedFee);
    
    // Performance Heavy: fee = baseFee × 0.2, bonusRate = (baseFee × 0.9) / (recentPPG × loanWeeks)
    const perfFee = baseFee * 0.20;
    const perfRate = (baseFee * 0.90) / (recentPPG * duration);
    const perfCap = 2 * (baseFee - perfFee);

    return {
      fixed: {
        fee: fixedFee,
        rate: 0,
        cap: 0,
      },
      balanced: {
        fee: balancedFee,
        rate: balancedRate,
        cap: balancedCap,
      },
      performance: {
        fee: perfFee,
        rate: perfRate,
        cap: perfCap,
      },
    };
  }, [selectedPlayer, baseFee, recentPPG, duration]);

  const { balancedMaxPpg, balancedHeadroom, perfMaxPpg, perfHeadroom } = useMemo(() => {
    const bMax = templateTerms.balanced.rate > 0 ? (templateTerms.balanced.cap / templateTerms.balanced.rate) / duration : 0;
    const pMax = templateTerms.performance.rate > 0 ? (templateTerms.performance.cap / templateTerms.performance.rate) / duration : 0;
    return {
      balancedMaxPpg: bMax,
      balancedHeadroom: bMax - recentPPG,
      perfMaxPpg: pMax,
      perfHeadroom: pMax - recentPPG,
    };
  }, [templateTerms, duration, recentPPG]);

  // Apply ±20% adjustment to the selected template
  const finalTerms = useMemo(() => {
    const terms = templateTerms[selectedTemplate];
    const multiplier = 1 + adjustment;
    return {
      fee: Math.round(terms.fee * multiplier),
      rate: parseFloat((terms.rate * multiplier).toFixed(3)),
      cap: Math.round(terms.cap * multiplier),
    };
  }, [templateTerms, selectedTemplate, adjustment]);

  const maxPossibleCost = finalTerms.fee + finalTerms.cap;

  const finalMaxAveragePpg = finalTerms.rate > 0 ? (finalTerms.cap / finalTerms.rate) / duration : 0;
  const finalOverperformanceHeadroom = finalMaxAveragePpg - recentPPG;

  // Expected Points & Bonus Payout Estimates
  const estPoints = Math.round(duration * recentPPG);
  const estBonusPayout = Math.min(finalTerms.cap, estPoints * finalTerms.rate);

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
          loanFee: finalTerms.fee,
          startGameweek,
          endGameweek,
          bonusRate: finalTerms.rate,
          bonusCap: finalTerms.cap,
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
              {step === 1 ? 'Request a Loan' : 'Propose Terms'}
            </h2>
            {isMocked && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(245,158,11,0.15)', color: '#d97706', padding: '2px 8px', borderRadius: '10px', fontSize: '9px', fontWeight: 600, marginTop: '4px' }}>
                ⚠️ preview mode: season at GW{currentGameweek} (mocked to GW10 for testing sliders)
              </div>
            )}
            {loanSlotsRemaining !== undefined && !selectedPlayer && (
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
              Select the club and player you want to request. They&apos;ll receive your proposed terms and can accept or counter.
            </p>

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
                          <span className={styles.blockToggleName}>{formatPlayerName(p, 'initial_last')}</span>
                          <span className={styles.blockToggleClub}>
                            {p.pl_team ?? ''}
                            {p.market_value ? ` · €${p.market_value.toFixed(1)}m` : ''}
                            {p.ppg ? ` · ${p.ppg.toFixed(1)} PPG` : ''}
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
          <form onSubmit={handleSubmit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>

            {/* Selected Player Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-bg-elevated)', padding: '14px 16px', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-accent-green)', borderTop: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
              <PositionBadge position={selectedPlayer.primary_position as any} size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {formatPlayerName(selectedPlayer, 'full')}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                  {allTeams.find(t => t.id === selectedTeamId)?.team_name} · {selectedPlayer.pl_team ?? ''}
                  {selectedPlayer.market_value ? ` · €${selectedPlayer.market_value.toFixed(1)}m MV` : ''}
                  {` · ${recentPPG.toFixed(1)} Projected PPG`}
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
              These are your <strong>proposed terms</strong>. The other manager can accept or negotiate.
            </div>

            {/* 1. Duration Slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Requested Loan Period</label>
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
                }}
              />
            </div>

            {/* 2. Three Template Cards */}
            <div>
              <label style={labelStyle}>Select Template Deal (Base Fee: €{baseFee}m)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '6px' }}>
                
                {/* Fixed Template */}
                <button
                  type="button"
                  onClick={() => setSelectedTemplate('fixed')}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: selectedTemplate === 'fixed' ? '2px solid var(--color-accent-blue)' : '1px solid var(--color-border)',
                    background: selectedTemplate === 'fixed' ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-elevated)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: selectedTemplate === 'fixed' ? 'var(--color-accent-blue)' : 'var(--color-text-primary)' }}>
                    Fixed
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                    Fee: €{Math.round(templateTerms.fixed.fee)}m
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', lineHeight: '1.2' }}>
                    Standard upfront fee. No performance bonus.
                  </span>
                </button>

                {/* Balanced Template */}
                <button
                  type="button"
                  onClick={() => setSelectedTemplate('balanced')}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: selectedTemplate === 'balanced' ? '2px solid var(--color-accent-blue)' : '1px solid var(--color-border)',
                    background: selectedTemplate === 'balanced' ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-elevated)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: selectedTemplate === 'balanced' ? 'var(--color-accent-blue)' : 'var(--color-text-primary)' }}>
                    Balanced
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                    Fee: €{Math.round(templateTerms.balanced.fee)}m
                    <br />
                    Bonus: €{templateTerms.balanced.rate.toFixed(3)}m/pt
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', lineHeight: '1.2' }}>
                    Moderate upfront fee. Capped at {balancedMaxPpg.toFixed(1)} PPG average (+{balancedHeadroom.toFixed(1)} over baseline).
                  </span>
                </button>

                {/* Performance Heavy Template */}
                <button
                  type="button"
                  onClick={() => setSelectedTemplate('performance')}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: selectedTemplate === 'performance' ? '2px solid var(--color-accent-blue)' : '1px solid var(--color-border)',
                    background: selectedTemplate === 'performance' ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-elevated)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: selectedTemplate === 'performance' ? 'var(--color-accent-blue)' : 'var(--color-text-primary)' }}>
                    Performance Heavy
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                    Fee: €{Math.round(templateTerms.performance.fee)}m
                    <br />
                    Bonus: €{templateTerms.performance.rate.toFixed(3)}m/pt
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', lineHeight: '1.2' }}>
                    Low upfront fee. Capped at {perfMaxPpg.toFixed(1)} PPG average (+{perfHeadroom.toFixed(1)} over baseline).
                  </span>
                </button>

              </div>
            </div>

            {/* 3. Price Adjustment Slider */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Price Adjustment Selector</label>
                <span style={{ fontSize: '12px', fontWeight: 700, color: adjustment === 0 ? 'var(--color-text-muted)' : adjustment > 0 ? 'var(--color-accent-green)' : 'var(--color-accent-red)' }}>
                  {adjustment === 0 ? 'Standard (0%)' : `${adjustment > 0 ? '+' : ''}${Math.round(adjustment * 100)}%`}
                </span>
              </div>
              <div style={{ position: 'relative', height: '26px' }}>
                <div style={{
                  position: 'absolute', top: '10px', left: 0, right: 0,
                  height: '6px', borderRadius: '3px',
                  background: 'linear-gradient(to right, #22c55e 0%, #3b82f6 50%, #ef4444 100%)',
                }} />
                <input
                  type="range"
                  min={-0.20}
                  max={0.20}
                  step={0.05}
                  value={adjustment}
                  onChange={(e) => setAdjustment(parseFloat(e.target.value))}
                  className={styles.feeRangeInput}
                  style={{ position: 'absolute', width: '100%', top: 0, margin: 0 }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                <span>-20% discount</span>
                <span>Standard (0%)</span>
                <span>+20% premium</span>
              </div>
            </div>

            {/* Optional Recall Clause Checkbox */}
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
                {hasRecall ? (
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                    Lender can cancel the loan early with 1 week notice. Pay €25m penalty flat to the borrowing club. No bonus refund.
                  </p>
                ) : (
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                    No early recall allowed. The player remains at the borrowing club for the full duration of the loan.
                  </p>
                )}
              </div>
            </div>

            {/* Cost Summary (Final terms shown to borrower) */}
            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-blue)', marginBottom: '10px' }}>
                Final Proposing Terms
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Loan fee (upfront, adjusted)</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {finalTerms.fee > 0 ? `€${finalTerms.fee}m` : 'Free'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Period</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    GW{startGameweek}–GW{endGameweek} ({duration} GWs)
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Recall Clause</span>
                  <span style={{ fontWeight: 600, color: hasRecall ? 'var(--color-accent-green)' : 'var(--color-text-muted)' }}>
                    {hasRecall ? 'Enabled (€25m flat penalty)' : 'Disabled'}
                  </span>
                </div>
                
                {selectedTemplate !== 'fixed' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Performance bonus rate</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                        €{finalTerms.rate.toFixed(3)}m / fantasy point
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Performance bonus cap</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
                        €{finalTerms.cap}m <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: 'normal', display: 'block' }}>(max {finalMaxAveragePpg.toFixed(1)} PPG / +{finalOverperformanceHeadroom.toFixed(1)} headroom)</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '1px dashed var(--color-border)', paddingTop: '4px', marginTop: '2px' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Est. performance bonus payout</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
                        €{estBonusPayout.toFixed(2)}m <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: 'normal', display: 'block' }}>(based on {recentPPG.toFixed(1)} Projected PPG)</span>
                      </span>
                    </div>
                  </>
                )}
                
                <div style={{ borderTop: '1px solid rgba(59,130,246,0.18)', marginTop: '4px', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>You pay at most</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-accent-blue)', fontSize: '15px' }}>
                    €{maxPossibleCost}m
                  </span>
                </div>
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
