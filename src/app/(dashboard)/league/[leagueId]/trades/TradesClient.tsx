'use client';

import { useState, useCallback, useEffect } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import PositionBadge from '@/components/players/PositionBadge';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import { Icon } from '@/components/ui/Icon';
import ListPlayerModal from './ListPlayerModal';
import ProposeLoanModal from './ProposeLoanModal';
import RequestLoanModal from './RequestLoanModal';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import styles from './trades.module.css';

export interface SimplePlayer {
  id: string;
  name: string;
  web_name: string | null;
  full_name?: string | null;
  pl_team?: string | null;
  projected_points?: number | null;
  market_value?: number | null;
  ppg?: number | null;
  form_rating?: number | null;
  primary_position: string;
  on_trade_block?: boolean;
}

interface SimpleTeam {
  id: string;
  team_name: string;
  faab_budget: number;
}

export interface TradeRecord {
  id: string;
  team_a_id: string;
  team_b_id: string;
  offered_players: string[];
  requested_players: string[];
  offered_faab: number;
  requested_faab: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  message: string | null;
  created_at: string;
  updated_at?: string;
  team_a?: { id: string; team_name: string };
  team_b?: { id: string; team_name: string };
}

export interface PlayerLoanRecord {
  id: string;
  league_id: string;
  lender_team_id: string;
  borrower_team_id: string;
  player_id: string;
  loan_fee: number;
  start_gameweek: number;
  end_gameweek: number;
  bonus_rate: number;
  bonus_cap: number;
  bonus_points_scored: number;
  bonus_settled: boolean;
  has_recall: boolean;
  recall_activated: boolean;
  recall_penalty: number | null;
  slot_buyback_used: boolean;
  slot_buyback_fee_paid: number | null;
  proposed_by?: 'lender' | 'borrower';
  status: 'pending' | 'active' | 'accepted_deferred' | 'recalled' | 'expired' | 'pending_activation' | 'rejected' | 'cancelled';
  message: string | null;
  created_at: string;
  lender_team?: { id: string; team_name: string };
  borrower_team?: { id: string; team_name: string };
  player?: any;
}

interface Props {
  leagueId: string;
  leagueName: string;
  myTeam: SimpleTeam;
  myRoster: any[];
  allTeams: SimpleTeam[];
  allTeamsIncludingMine: SimpleTeam[];
  allRosters: Record<string, any[]>;
  initialTrades: TradeRecord[];
  leagueTrades: any[];
  initialPlayerMap: Record<string, SimplePlayer>;
  initialListings: any[];
  listingHighestBids: Record<string, number>;
  rosterSize?: number;
  initialLoans?: PlayerLoanRecord[];
  currentGameweek?: number;
  initialTab?: 'trades' | 'league-feed' | 'listings' | 'loans';
  leagueSettings?: {
    loan_slot_buyback_fee: number;
    loan_bonus_cap_default: number;
    max_loan_outs: number;
    max_loan_ins: number;
    total_gameweeks: number;
    roster_locked: boolean;
  };
}

type Tab = 'trades' | 'league-feed' | 'listings' | 'loans';

function playerDisplayName(p: SimplePlayer) {
  return getPlayerDisplayName(p, 'initial_last');
}

export default function TradesClient({
  leagueId,
  leagueName,
  myTeam,
  myRoster,
  allTeams,
  allRosters,
  initialTrades,
  leagueTrades,
  initialPlayerMap,
  initialListings,
  listingHighestBids,
  rosterSize = 20,
  initialLoans = [],
  currentGameweek = 1,
  initialTab = 'league-feed',
  leagueSettings = {
    loan_slot_buyback_fee: 25,
    loan_bonus_cap_default: 0,
    max_loan_outs: 1,
    max_loan_ins: 2,
    total_gameweeks: 38,
    roster_locked: false,
  },
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [trades, setTrades] = useState<TradeRecord[]>(initialTrades);
  const [playerMap, setPlayerMap] = useState<Record<string, SimplePlayer>>(initialPlayerMap);
  const [localMyRoster, setLocalMyRoster] = useState<any[]>(myRoster);

  // Trade rows carry only a thin player shape (no photo or ranks), so the card
  // opens by id off the shared cache rather than painting a half-filled front.
  const { openPlayerById, prefetchPlayer } = usePlayerCard();
  const setViewingPlayer = useCallback(
    (p: SimplePlayer | null) => {
      if (p) openPlayerById(p.id);
    },
    [openPlayerById],
  );

  // Player Market
  const [showListModal, setShowListModal] = useState(false);
  const [listings, setListings] = useState<any[]>(initialListings);
  const [highestBids, setHighestBids] = useState<Record<string, number>>(listingHighestBids);

  // Loans
  const [loans, setLoans] = useState<PlayerLoanRecord[]>(initialLoans);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showRequestLoanModal, setShowRequestLoanModal] = useState(false);

  // Propose Trade state (inline within Trades tab)
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [offeredPlayerIds, setOfferedPlayerIds] = useState<Set<string>>(new Set());
  const [requestedPlayerIds, setRequestedPlayerIds] = useState<Set<string>>(new Set());
  const [offeredFaab, setOfferedFaab] = useState('0');
  const [requestedFaab, setRequestedFaab] = useState('0');
  const [tradeMessage, setTradeMessage] = useState('');
  const [parentTradeId, setParentTradeId] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState('');
  const [proposeSuccess, setProposeSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Trade action state
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const targetTeam = allTeams.find((t) => t.id === selectedTeamId);
  const targetRoster: SimplePlayer[] = selectedTeamId ? (allRosters[selectedTeamId] ?? []) : [];

  // ── Trade Actions ─────────────────────────────────────────────────────────

  const handleTradeAction = useCallback(async (tradeId: string, action: 'accept' | 'reject' | 'cancel') => {
    setActionLoading((prev) => ({ ...prev, [tradeId]: true }));
    setActionError((prev) => ({ ...prev, [tradeId]: '' }));

    const res = await fetch(`/api/leagues/${leagueId}/trades/${tradeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });

    const data = await res.json();

    if (!res.ok) {
      setActionError((prev) => ({ ...prev, [tradeId]: data.error ?? 'Something went wrong.' }));
      setActionLoading((prev) => ({ ...prev, [tradeId]: false }));
      return;
    }

    const refreshRes = await fetch(`/api/leagues/${leagueId}/trades`);
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      setTrades(refreshData.trades ?? []);
      setPlayerMap((prev) => ({ ...prev, ...refreshData.playerMap }));
    }
    setActionLoading((prev) => ({ ...prev, [tradeId]: false }));
  }, [leagueId]);

  const handleCounter = useCallback((trade: TradeRecord) => {
    const isProposer = trade.team_a_id === myTeam.id;
    const targetTeamId = isProposer ? trade.team_b_id : trade.team_a_id;
    const myOfferPlayers = isProposer ? trade.offered_players : trade.requested_players;
    const myRequestPlayers = isProposer ? trade.requested_players : trade.offered_players;
    const myOfferFaab = isProposer ? trade.offered_faab : trade.requested_faab;
    const myRequestFaab = isProposer ? trade.requested_faab : trade.offered_faab;

    setSelectedTeamId(targetTeamId);
    setOfferedPlayerIds(new Set(myOfferPlayers));
    setRequestedPlayerIds(new Set(myRequestPlayers));
    setOfferedFaab(String(myOfferFaab));
    setRequestedFaab(String(myRequestFaab));
    setTradeMessage('');
    setParentTradeId(trade.id);
    setShowProposeForm(true);
    setProposeSuccess('');
  }, [myTeam.id]);

  const handlePropose = useCallback(async () => {
    setProposeError('');
    setProposeSuccess('');

    if (!selectedTeamId) { setProposeError('Select a team to trade with.'); return; }
    if (offeredPlayerIds.size === 0 && requestedPlayerIds.size === 0) {
      setProposeError('Add at least one player to the trade.'); return;
    }

    const offFaab = parseInt(offeredFaab, 10) || 0;
    const reqFaab = parseInt(requestedFaab, 10) || 0;

    if (offFaab > myTeam.faab_budget) {
      setProposeError(`You only have €${myTeam.faab_budget}m in Club Balance — cannot offer €${offFaab}m.`); return;
    }
    if (targetTeam && reqFaab > targetTeam.faab_budget) {
      setProposeError(`${targetTeam.team_name} only has €${targetTeam.faab_budget}m in Club Balance.`); return;
    }

    setSubmitting(true);

    const res = await fetch(`/api/leagues/${leagueId}/trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetTeamId: selectedTeamId,
        offeredPlayerIds: Array.from(offeredPlayerIds),
        requestedPlayerIds: Array.from(requestedPlayerIds),
        offeredFaab: offFaab,
        requestedFaab: reqFaab,
        message: tradeMessage || undefined,
        parentTradeId: parentTradeId || undefined,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setProposeError(data.error ?? 'Something went wrong.');
      setSubmitting(false);
      return;
    }

    resetProposeForm();
    setProposeSuccess('Trade proposal sent!');

    const refreshRes = await fetch(`/api/leagues/${leagueId}/trades`);
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      setTrades(refreshData.trades ?? []);
      setPlayerMap((prev) => ({ ...prev, ...refreshData.playerMap }));
    }

    setSubmitting(false);
    setShowProposeForm(false);
  }, [leagueId, selectedTeamId, offeredPlayerIds, requestedPlayerIds, offeredFaab, requestedFaab, tradeMessage, parentTradeId, myTeam, targetTeam]);

  function resetProposeForm() {
    setOfferedPlayerIds(new Set());
    setRequestedPlayerIds(new Set());
    setOfferedFaab('0');
    setRequestedFaab('0');
    setTradeMessage('');
    setProposeError('');
    setParentTradeId(null);
    setSelectedTeamId('');
  }

  function toggleOffered(playerId: string) {
    setOfferedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function toggleRequested(playerId: string) {
    setRequestedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  // ── Listings Callbacks ────────────────────────────────────────────────────

  function handleListingChange(playerId: string, listing: any | null) {
    setLocalMyRoster((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, listing } : p))
    );
    if (listing) {
      setListings((prev) => [...prev.filter((l) => l.player_id !== playerId), listing]);
    } else {
      setListings((prev) => prev.filter((l) => l.player_id !== playerId));
    }
  }

  // ── Loan Callbacks ────────────────────────────────────────────────────────

  const refreshLoans = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans`);
      if (res.ok) {
        const data = await res.json();
        const merged = [...(data.loansOut ?? []), ...(data.loansIn ?? [])];
        setLoans(merged);
      }
    } catch (err) {
      console.error('Failed to refresh loans:', err);
    }
  }, [leagueId]);

  const handleLoanAction = useCallback(async (loanId: string, action: 'accept' | 'reject' | 'cancel') => {
    setActionLoading((prev) => ({ ...prev, [loanId]: true }));
    setActionError((prev) => ({ ...prev, [loanId]: '' }));

    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans/${loanId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [loanId]: data.error ?? 'Something went wrong.' }));
      } else {
        if (data.deferred) {
          setProposeSuccess('Loan accepted but deferred until gameweek ends — player is locked.');
        } else {
          setProposeSuccess(`Loan ${action}ed successfully!`);
        }
        await refreshLoans();
      }
    } catch (err) {
      console.error(err);
      setActionError((prev) => ({ ...prev, [loanId]: 'An unexpected error occurred.' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [loanId]: false }));
    }
  }, [leagueId, refreshLoans]);

  const handleLoanRecall = useCallback(async (loanId: string) => {
    setActionLoading((prev) => ({ ...prev, [loanId]: true }));
    setActionError((prev) => ({ ...prev, [loanId]: '' }));

    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans/${loanId}/recall`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [loanId]: data.error ?? 'Something went wrong.' }));
      } else {
        let msg = `Loan recalled! Penalty paid: €${data.penalty}m.`;
        if (data.bonusPaid > 0) msg += ` Bonus paid: €${data.bonusPaid}m.`;
        if (data.pendingActivation) msg += ` Player returning — roster full (pending drop).`;
        setProposeSuccess(msg);
        await refreshLoans();
      }
    } catch {
      setActionError((prev) => ({ ...prev, [loanId]: 'An unexpected error occurred.' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [loanId]: false }));
    }
  }, [leagueId, refreshLoans]);

  const handleLoanSlotBuyback = useCallback(async (loanId: string) => {
    setActionLoading((prev) => ({ ...prev, [loanId]: true }));
    setActionError((prev) => ({ ...prev, [loanId]: '' }));

    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans/${loanId}/slot-buyback`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [loanId]: data.error ?? 'Something went wrong.' }));
      } else {
        setProposeSuccess(`Slot buyback activated! Paid €${data.feePaid}m.`);
        await refreshLoans();
      }
    } catch {
      setActionError((prev) => ({ ...prev, [loanId]: 'An unexpected error occurred.' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [loanId]: false }));
    }
  }, [leagueId, refreshLoans]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const pendingTrades = trades.filter((t) => t.status === 'pending');
  const incomingTrades = pendingTrades.filter((t) => t.team_b_id === myTeam.id);
  const sentTrades = pendingTrades.filter((t) => t.team_a_id === myTeam.id);
  const pastTrades = trades.filter((t) => t.status !== 'pending');

  // Pending inbound = loans I need to respond to:
  //   - lender-proposed loans where I'm the borrower
  //   - borrower-requested loans (request mode) where I'm the lender
  const pendingInboundLoans = loans.filter((l) => l.status === 'pending' && (
    ((l.proposed_by ?? 'lender') === 'lender' && l.borrower_team_id === myTeam.id) ||
    (l.proposed_by === 'borrower' && l.lender_team_id === myTeam.id)
  ));

  // Pending outbound = loans I'm waiting for a response on:
  //   - lender-proposed loans where I'm the lender
  //   - borrower-requested loans where I'm the borrower
  const pendingOutboundLoans = loans.filter((l) => l.status === 'pending' && (
    ((l.proposed_by ?? 'lender') === 'lender' && l.lender_team_id === myTeam.id) ||
    (l.proposed_by === 'borrower' && l.borrower_team_id === myTeam.id)
  ));

  const activeLoansOut = loans.filter((l) => l.lender_team_id === myTeam.id && ['active', 'accepted_deferred', 'pending_activation'].includes(l.status));
  const activeLoansIn = loans.filter((l) => l.borrower_team_id === myTeam.id && ['active', 'accepted_deferred', 'pending_activation'].includes(l.status));
  const historicalLoans = loans.filter((l) => ['expired', 'recalled', 'rejected', 'cancelled'].includes(l.status));

  // Loan slot info
  const remainingLoanOuts = Math.max(0, leagueSettings.max_loan_outs - activeLoansOut.length);
  const remainingLoanIns = Math.max(0, leagueSettings.max_loan_ins - activeLoansIn.length);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <NavigationLink href={`/league/${leagueId}`}>{leagueName}</NavigationLink> / Transfers
          </p>
          <h1 className={styles.title}>Transfers Hub</h1>
          {pendingTrades.length > 0 && (
            <p className={styles.pendingHint}>
              {incomingTrades.length > 0
                ? `${incomingTrades.length} incoming trade${incomingTrades.length > 1 ? 's' : ''} awaiting your response`
                : `${sentTrades.length} proposal${sentTrades.length > 1 ? 's' : ''} awaiting response`}
            </p>
          )}
        </div>
        <div className={styles.faabBadge}>
          <span className={styles.faabLabel}>Club Balance</span>
          <span className={styles.faabAmount}>€{myTeam.faab_budget}m</span>
        </div>
      </header>

      {/* ── Tab Bar (4 tabs) ── */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'league-feed' ? styles.tabActive : ''}`}
          onClick={() => setTab('league-feed')}
        >
          Trade Feed
        </button>
        <button
          className={`${styles.tab} ${tab === 'trades' ? styles.tabActive : ''}`}
          onClick={() => { setTab('trades'); setProposeSuccess(''); }}
        >
          Trades
          {pendingTrades.length > 0 && (
            <span className={styles.tabBadge}>{pendingTrades.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${tab === 'listings' ? styles.tabActive : ''}`}
          onClick={() => { setTab('listings'); setProposeSuccess(''); }}
        >
          Player Sales
        </button>
        <button
          className={`${styles.tab} ${tab === 'loans' ? styles.tabActive : ''}`}
          onClick={() => { setTab('loans'); setProposeSuccess(''); setShowProposeForm(false); }}
        >
          Player Loans
          {pendingInboundLoans.length > 0 && (
            <span className={styles.tabBadge}>{pendingInboundLoans.length}</span>
          )}
        </button>
      </div>

      {/* ── Trades Tab ── */}
      {tab === 'trades' && (
        <div className={styles.tradesSection}>
          {proposeSuccess && !showProposeForm && (
            <div className={styles.successBanner}>{proposeSuccess}</div>
          )}

          {/* Inline Propose Trade Form */}
          {showProposeForm ? (
            <div className={styles.proposeSection}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Propose a Trade</h2>
                <button
                  className={styles.inlineLinkBtn}
                  onClick={() => { resetProposeForm(); setShowProposeForm(false); }}
                >
                  ← Back to trades
                </button>
              </div>

              {/* Team selector */}
              <div className={styles.teamSelector}>
                <label className={styles.fieldLabel}>Trade with:</label>
                <select
                  className={styles.select}
                  value={selectedTeamId}
                  onChange={(e) => {
                    setSelectedTeamId(e.target.value);
                    setOfferedPlayerIds(new Set());
                    setRequestedPlayerIds(new Set());
                  }}
                >
                  <option value="">— Select a team —</option>
                  {allTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.team_name} (€{t.faab_budget}m)
                    </option>
                  ))}
                </select>
              </div>

              {selectedTeamId && (
                <>
                  <div className={styles.splitScreen}>
                    {/* My Roster */}
                    <div className={styles.rosterPanel}>
                      <div className={styles.rosterHeader}>
                        <h3 className={styles.rosterTitle}>Your Roster</h3>
                        <span className={styles.rosterHint}>Click to offer</span>
                      </div>
                      <div className={styles.rosterList}>
                        {localMyRoster.length === 0 ? (
                          <p className={styles.emptyRoster}>No players on your roster.</p>
                        ) : (
                          localMyRoster.map((p) => (
                            <div
                              key={p.id}
                              className={`${styles.rosterPlayer} ${offeredPlayerIds.has(p.id) ? styles.rosterPlayerSelected : ''}`}
                              onClick={() => toggleOffered(p.id)}
                              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <PositionBadge position={p.primary_position as any} size="sm" />
                              <span
                                onClick={(e) => { e.stopPropagation(); setViewingPlayer(p); }}
                                onPointerEnter={() => prefetchPlayer(p as { id: string })}
                                className={styles.tradePlayerNameLink}
                              >
                                {playerDisplayName(p)}
                              </span>
                              <span className={styles.rosterPlayerClub}>
                                {p.pl_team}
                                {p.projected_points != null && (
                                  <span style={{ color: 'var(--color-text-secondary)', marginLeft: '8px' }}>
                                    Proj: {Number(p.projected_points).toFixed(1)}
                                  </span>
                                )}
                              </span>
                              {offeredPlayerIds.has(p.id) && <span className={styles.checkmark}>✓</span>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Target Roster */}
                    <div className={styles.rosterPanel}>
                      <div className={styles.rosterHeader}>
                        <h3 className={styles.rosterTitle}>{targetTeam?.team_name}</h3>
                        <span className={styles.rosterHint}>Click to request</span>
                      </div>
                      <div className={styles.rosterList}>
                        {targetRoster.length === 0 ? (
                          <p className={styles.emptyRoster}>No players on this roster.</p>
                        ) : (
                          targetRoster.map((p) => (
                            <div
                              key={p.id}
                              className={`${styles.rosterPlayer} ${requestedPlayerIds.has(p.id) ? styles.rosterPlayerSelected : ''}`}
                              onClick={() => toggleRequested(p.id)}
                              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <PositionBadge position={p.primary_position as any} size="sm" />
                              <span
                                onClick={(e) => { e.stopPropagation(); setViewingPlayer(p); }}
                                onPointerEnter={() => prefetchPlayer(p as { id: string })}
                                className={styles.tradePlayerNameLink}
                              >
                                {playerDisplayName(p)}
                              </span>
                              <span className={styles.rosterPlayerClub}>
                                {p.pl_team}
                                {p.projected_points != null && (
                                  <span style={{ color: 'var(--color-text-secondary)', marginLeft: '8px' }}>
                                    Proj: {Number(p.projected_points).toFixed(1)}
                                  </span>
                                )}
                              </span>
                              {requestedPlayerIds.has(p.id) && <span className={styles.checkmark}>✓</span>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Trade Dock */}
                  <div className={styles.dock}>
                    <h3 className={styles.dockTitle}>Trade Proposal</h3>
                    <div className={styles.dockSides}>
                      <div className={styles.dockSide}>
                        <p className={styles.dockSideLabel}>You send:</p>
                        {offeredPlayerIds.size === 0 && parseInt(offeredFaab) === 0 ? (
                          <p className={styles.dockEmpty}>Nothing selected</p>
                        ) : (
                          <>
                            {Array.from(offeredPlayerIds).map((id) => {
                              const p = localMyRoster.find((r) => r.id === id);
                              return p ? (
                                <div key={id} className={styles.dockPlayer}>
                                  <PositionBadge position={p.primary_position as any} size="sm" />
                                  <span>{playerDisplayName(p)}</span>
                                </div>
                              ) : null;
                            })}
                            {parseInt(offeredFaab) > 0 && (
                              <div className={styles.dockFaab}>+ €{offeredFaab}m Cash</div>
                            )}
                          </>
                        )}
                        <div className={styles.faabInput}>
                          <label className={styles.fieldLabel}>Include Cash (€m):</label>
                          <input
                            type="number" min={0} max={myTeam.faab_budget} step={1}
                            className={styles.numInput}
                            value={offeredFaab}
                            onChange={(e) => setOfferedFaab(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className={styles.dockArrow}>⇄</div>

                      <div className={styles.dockSide}>
                        <p className={styles.dockSideLabel}>You receive:</p>
                        {requestedPlayerIds.size === 0 && parseInt(requestedFaab) === 0 ? (
                          <p className={styles.dockEmpty}>Nothing selected</p>
                        ) : (
                          <>
                            {Array.from(requestedPlayerIds).map((id) => {
                              const p = targetRoster.find((r) => r.id === id);
                              return p ? (
                                <div key={id} className={styles.dockPlayer}>
                                  <PositionBadge position={p.primary_position as any} size="sm" />
                                  <span>{playerDisplayName(p)}</span>
                                </div>
                              ) : null;
                            })}
                            {parseInt(requestedFaab) > 0 && (
                              <div className={styles.dockFaab}>+ €{requestedFaab}m Cash</div>
                            )}
                          </>
                        )}
                        <div className={styles.faabInput}>
                          <label className={styles.fieldLabel}>Request Cash (€m):</label>
                          <input
                            type="number" min={0} max={targetTeam?.faab_budget ?? 0} step={1}
                            className={styles.numInput}
                            value={requestedFaab}
                            onChange={(e) => setRequestedFaab(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className={styles.dockMessage}>
                      <label className={styles.fieldLabel}>Message (optional):</label>
                      <textarea
                        className={styles.messageInput}
                        placeholder="Add a note to your trade offer…"
                        rows={2}
                        value={tradeMessage}
                        onChange={(e) => setTradeMessage(e.target.value)}
                      />
                    </div>

                    {proposeError && <p className={styles.errorBanner}>{proposeError}</p>}

                    <div className={styles.dockActions}>
                      <button
                        className={styles.resetBtn}
                        onClick={resetProposeForm}
                      >
                        Reset
                      </button>
                      <button
                        className={styles.submitTradeBtn}
                        onClick={handlePropose}
                        disabled={submitting}
                      >
                        {submitting ? 'Sending…' : 'Send Trade Proposal'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Trades list view */
            <>
              {trades.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>No trades yet.</p>
                  <button className={styles.proposeBtn} onClick={() => setShowProposeForm(true)}>
                    Propose a Trade
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                    <button className={styles.addToBlockBtn} onClick={() => { resetProposeForm(); setShowProposeForm(true); }}>
                      + Propose a Trade
                    </button>
                  </div>

                  {/* Incoming */}
                  {incomingTrades.length > 0 && (
                    <div className={styles.tradeGroup}>
                      <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron-left" size={16} /></span>
                        <h2 className={styles.tradeGroupTitle}>Incoming Proposals</h2>
                        <span className={styles.tradeSubGroupHint}>Awaiting your response</span>
                      </div>
                      <div className={styles.pendingGrid}>
                        {incomingTrades.map((trade) => (
                          <TradeCard
                            key={trade.id}
                            trade={trade}
                            myTeamId={myTeam.id}
                            playerMap={playerMap}
                            onAction={handleTradeAction}
                            onCounter={handleCounter}
                            onViewPlayer={setViewingPlayer}
                            error={actionError[trade.id] ?? ''}
                            loading={!!actionLoading[trade.id]}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sent */}
                  {sentTrades.length > 0 && (
                    <div className={styles.tradeGroup}>
                      <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron-right" size={16} /></span>
                        <h2 className={styles.tradeGroupTitle}>Sent</h2>
                        <span className={styles.tradeSubGroupHint}>Awaiting their response</span>
                      </div>
                      {sentTrades.map((trade) => (
                        <TradeCard
                          key={trade.id}
                          trade={trade}
                          myTeamId={myTeam.id}
                          playerMap={playerMap}
                          onAction={handleTradeAction}
                          onCounter={handleCounter}
                          onViewPlayer={setViewingPlayer}
                          error={actionError[trade.id] ?? ''}
                          loading={!!actionLoading[trade.id]}
                        />
                      ))}
                    </div>
                  )}

                  {pendingTrades.length === 0 && (
                    <p className={styles.noPendingHint}>
                      No active proposals.{' '}
                      <button className={styles.inlineLinkBtn} onClick={() => { resetProposeForm(); setShowProposeForm(true); }}>
                        Propose one →
                      </button>
                    </p>
                  )}

                  {/* History */}
                  {pastTrades.length > 0 && (
                    <div className={styles.tradeGroup}>
                      <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="activity" size={16} /></span>
                        <h2 className={styles.tradeGroupTitle}>History</h2>
                      </div>
                      {pastTrades.map((trade) => (
                        <TradeCard
                          key={trade.id}
                          trade={trade}
                          myTeamId={myTeam.id}
                          playerMap={playerMap}
                          onAction={handleTradeAction}
                          onCounter={handleCounter}
                          onViewPlayer={setViewingPlayer}
                          error={actionError[trade.id] ?? ''}
                          loading={!!actionLoading[trade.id]}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── League Feed Tab ── */}
      {tab === 'league-feed' && (
        <div className={styles.tradesSection}>
          <div className={styles.leagueFeedHeader}>
            <span className={styles.leagueFeedLabel}>SEASON-LONG TRADES</span>
            <h2 className={styles.tradeGroupTitle}>League Trade Feed</h2>
            <p className={styles.leagueFeedSubtitle}>All completed trades across the league, most recent first.</p>
          </div>

          {leagueTrades.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No trades have been completed in this league yet.</p>
            </div>
          ) : (
            <div className={styles.leagueFeedList}>
              {leagueTrades.map((trade: any) => {
                const teamAName = trade.team_a?.team_name ?? 'Team A';
                const teamBName = trade.team_b?.team_name ?? 'Team B';
                const offeredPlayers: SimplePlayer[] = (trade.offered_players ?? []).map((id: string) => playerMap[id]).filter(Boolean);
                const requestedPlayers: SimplePlayer[] = (trade.requested_players ?? []).map((id: string) => playerMap[id]).filter(Boolean);
                const date: string = trade.updated_at ?? trade.created_at;
                const isInvolved: boolean = trade.team_a_id === myTeam.id || trade.team_b_id === myTeam.id;

                return (
                  <div key={trade.id} className={`${styles.leagueFeedRow} ${isInvolved ? styles.leagueFeedRowMine : ''}`}>
                    <div className={styles.leagueFeedRowHeader}>
                      <div className={styles.leagueFeedTeams}>
                        <span className={`${styles.leagueFeedTeamName} ${trade.team_a_id === myTeam.id ? styles.myTeamHighlight : ''}`}>{teamAName}</span>
                        <span className={styles.leagueFeedSwap}>⇄</span>
                        <span className={`${styles.leagueFeedTeamName} ${trade.team_b_id === myTeam.id ? styles.myTeamHighlight : ''}`}>{teamBName}</span>
                        {isInvolved && <span className={styles.leagueFeedMineTag}>YOUR DEAL</span>}
                      </div>
                      <div className={styles.leagueFeedRowMeta}>
                        <span className={styles.leagueFeedStatus}>COMPLETED</span>
                        <span className={styles.leagueFeedDate}>
                          {new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    <div className={styles.leagueFeedDeal}>
                      <div className={styles.leagueFeedSide}>
                        <span className={styles.leagueFeedSideLabel}>{teamAName} sent:</span>
                        <div className={styles.leagueFeedPlayers}>
                          {offeredPlayers.length > 0 ? offeredPlayers.map((p: SimplePlayer) => (
                            <span key={p.id} className={styles.leagueFeedPlayerChip}>
                              <PositionBadge position={p.primary_position as any} size="sm" />
                              {getPlayerDisplayName(p, 'initial_last')}
                            </span>
                          )) : <span className={styles.leagueFeedNone}>—</span>}
                          {trade.offered_faab > 0 && <span className={styles.leagueFeedFaab}>+€{trade.offered_faab}m</span>}
                        </div>
                      </div>
                      <div className={styles.leagueFeedSide}>
                        <span className={styles.leagueFeedSideLabel}>{teamBName} sent:</span>
                        <div className={styles.leagueFeedPlayers}>
                          {requestedPlayers.length > 0 ? requestedPlayers.map((p: SimplePlayer) => (
                            <span key={p.id} className={styles.leagueFeedPlayerChip}>
                              <PositionBadge position={p.primary_position as any} size="sm" />
                              {getPlayerDisplayName(p, 'initial_last')}
                            </span>
                          )) : <span className={styles.leagueFeedNone}>—</span>}
                          {trade.requested_faab > 0 && <span className={styles.leagueFeedFaab}>+€{trade.requested_faab}m</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Player Market Tab ── */}
      {tab === 'listings' && (
        <div className={styles.tradesSection}>
          <div className={styles.tradeBlockSectionHeader}>
            <div>
              <span className={styles.leagueFeedLabel}>AVAILABLE FOR DEALS & AUCTION</span>
              <h2 className={styles.tradeGroupTitle}>Player Sales</h2>
              <p className={styles.leagueFeedSubtitle}>
                Bid on or propose trades for players listed by other managers.
              </p>
            </div>
            <button className={styles.addToBlockBtn} onClick={() => setShowListModal(true)}>
              + List a Player
            </button>
          </div>

          {listings.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No players are currently listed on the market.</p>
              <button className={styles.proposeBtn} onClick={() => setShowListModal(true)}>
                List your players
              </button>
            </div>
          ) : (
            <div className={styles.tradeBlockGrid}>
              {listings.map((l) => {
                const p = l.player;
                if (!p) return null;
                const isMe = l.seller_team_id === myTeam.id;
                const highestBid = highestBids[l.id] ?? 0;

                return (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    highestBid={highestBid}
                    isMe={isMe}
                    leagueId={leagueId}
                    myTeam={myTeam}
                    localMyRoster={localMyRoster}
                    rosterSize={rosterSize}
                    onBidSuccess={async () => {
                      const refreshRes = await fetch(`/api/leagues/${leagueId}/listings`);
                      if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        setListings(refreshData.listings);
                        setHighestBids(refreshData.highestBids);
                        const myPlayerListings: Record<string, any> = {};
                        for (const listEntry of refreshData.listings) {
                          if (listEntry.seller_team_id === myTeam.id) {
                            myPlayerListings[listEntry.player_id] = listEntry;
                          }
                        }
                        setLocalMyRoster((prev) =>
                          prev.map((r) => ({ ...r, listing: myPlayerListings[r.id] ?? null }))
                        );
                      }
                    }}
                    onProposeTrade={() => {
                      setSelectedTeamId(l.seller_team_id);
                      setOfferedPlayerIds(new Set());
                      setRequestedPlayerIds(new Set([p.id]));
                      setShowProposeForm(true);
                      setTab('trades');
                    }}
                    onCancelListing={() => handleListingChange(p.id, null)}
                    onViewPlayer={setViewingPlayer}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Player Loans Tab ── */}
      {tab === 'loans' && (
        <div className={styles.tradesSection}>
          {proposeSuccess && (
            <div className={styles.successBanner}>{proposeSuccess}</div>
          )}

          <div className={styles.tradeBlockSectionHeader}>
            <div>
              <span className={styles.leagueFeedLabel}>TEMPORARY TRANSFERS</span>
              <h2 className={styles.tradeGroupTitle}>Player Loans</h2>
              <p className={styles.leagueFeedSubtitle}>
                Propose or request player loans, manage active deals, and track performance bonuses.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                className={styles.addToBlockBtn}
                onClick={() => setShowRequestLoanModal(true)}
                title="Request a loan of a player from another club"
              >
                ← Request a Loan
              </button>
              <button
                className={styles.addToBlockBtn}
                onClick={() => setShowLoanModal(true)}
                title="Propose to loan one of your players to another club"
              >
                → Propose a Loan
              </button>
            </div>
          </div>

          {loans.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No active or pending loans.</p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '12px' }}>
                <button className={styles.addToBlockBtn} onClick={() => setShowRequestLoanModal(true)}>
                  Request a Loan
                </button>
                <button className={styles.addToBlockBtn} onClick={() => setShowLoanModal(true)}>
                  Propose a Loan
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

              {/* 1. Pending Inbound */}
              {pendingInboundLoans.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="mail" size={16} /></span>
                    <h3 className={styles.tradeGroupTitle}>Awaiting Your Response</h3>
                    <span className={styles.tradeSubGroupHint}>
                      Loan proposals or requests that need your decision
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {pendingInboundLoans.map((loan) => (
                      <LoanCard
                        key={loan.id}
                        loan={loan}
                        myTeamId={myTeam.id}
                        onAction={handleLoanAction}
                        onRecall={handleLoanRecall}
                        onSlotBuyback={handleLoanSlotBuyback}
                        onViewPlayer={setViewingPlayer}
                        error={actionError[loan.id] ?? ''}
                        loading={actionLoading[loan.id] ?? false}
                        buybackFee={leagueSettings.loan_slot_buyback_fee}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Pending Outbound */}
              {pendingOutboundLoans.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chevron-right" size={16} /></span>
                    <h3 className={styles.tradeGroupTitle}>Pending — Awaiting Response</h3>
                    <span className={styles.tradeSubGroupHint}>
                      Loans or requests you initiated, awaiting the other club
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {pendingOutboundLoans.map((loan) => (
                      <LoanCard
                        key={loan.id}
                        loan={loan}
                        myTeamId={myTeam.id}
                        onAction={handleLoanAction}
                        onRecall={handleLoanRecall}
                        onSlotBuyback={handleLoanSlotBuyback}
                        onViewPlayer={setViewingPlayer}
                        error={actionError[loan.id] ?? ''}
                        loading={actionLoading[loan.id] ?? false}
                        buybackFee={leagueSettings.loan_slot_buyback_fee}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Active Loans In */}
              {activeLoansIn.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="users" size={16} /></span>
                    <h3 className={styles.tradeGroupTitle}>Active Loans In (Borrowed)</h3>
                    <span className={styles.tradeSubGroupHint}>Players temporarily on your squad</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {activeLoansIn.map((loan) => (
                      <LoanCard
                        key={loan.id}
                        loan={loan}
                        myTeamId={myTeam.id}
                        onAction={handleLoanAction}
                        onRecall={handleLoanRecall}
                        onSlotBuyback={handleLoanSlotBuyback}
                        onViewPlayer={setViewingPlayer}
                        error={actionError[loan.id] ?? ''}
                        loading={actionLoading[loan.id] ?? false}
                        buybackFee={leagueSettings.loan_slot_buyback_fee}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Active Loans Out */}
              {activeLoansOut.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="repeat" size={16} /></span>
                    <h3 className={styles.tradeGroupTitle}>Active Loans Out (Loaned Out)</h3>
                    <span className={styles.tradeSubGroupHint}>Your players temporarily at other clubs</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {activeLoansOut.map((loan) => (
                      <LoanCard
                        key={loan.id}
                        loan={loan}
                        myTeamId={myTeam.id}
                        onAction={handleLoanAction}
                        onRecall={handleLoanRecall}
                        onSlotBuyback={handleLoanSlotBuyback}
                        onViewPlayer={setViewingPlayer}
                        error={actionError[loan.id] ?? ''}
                        loading={actionLoading[loan.id] ?? false}
                        buybackFee={leagueSettings.loan_slot_buyback_fee}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Historical */}
              {historicalLoans.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.tradeSubGroupIcon} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="layout" size={16} /></span>
                    <h3 className={styles.tradeGroupTitle}>Loan History</h3>
                    <span className={styles.tradeSubGroupHint}>Past loan agreements</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {historicalLoans.map((loan) => (
                      <LoanCard
                        key={loan.id}
                        loan={loan}
                        myTeamId={myTeam.id}
                        onAction={handleLoanAction}
                        onRecall={handleLoanRecall}
                        onSlotBuyback={handleLoanSlotBuyback}
                        onViewPlayer={setViewingPlayer}
                        error={actionError[loan.id] ?? ''}
                        loading={actionLoading[loan.id] ?? false}
                        buybackFee={leagueSettings.loan_slot_buyback_fee}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── (the player card is owned by PlayerCardProvider) */}
      {showListModal && (
        <ListPlayerModal
          leagueId={leagueId}
          myTeamId={myTeam.id}
          myRoster={localMyRoster}
          onClose={() => setShowListModal(false)}
          onListed={(playerId, listing) => handleListingChange(playerId, listing)}
          onCancelled={(playerId) => handleListingChange(playerId, null)}
        />
      )}

      {showLoanModal && (
        <ProposeLoanModal
          leagueId={leagueId}
          myRoster={localMyRoster}
          allTeams={allTeams}
          currentGameweek={currentGameweek}
          loanSlotsRemaining={remainingLoanOuts}
          bonusCapDefault={leagueSettings.loan_bonus_cap_default}
          totalGameweeks={leagueSettings.total_gameweeks}
          onClose={() => setShowLoanModal(false)}
          onProposed={async () => {
            setProposeSuccess('Loan proposal submitted successfully!');
            await refreshLoans();
          }}
        />
      )}

      {showRequestLoanModal && (
        <RequestLoanModal
          leagueId={leagueId}
          allTeams={allTeams}
          allRosters={allRosters}
          currentGameweek={currentGameweek}
          loanSlotsRemaining={remainingLoanIns}
          bonusCapDefault={leagueSettings.loan_bonus_cap_default}
          totalGameweeks={leagueSettings.total_gameweeks}
          onClose={() => setShowRequestLoanModal(false)}
          onRequested={async () => {
            setProposeSuccess('Loan request sent! They will be notified to review your terms.');
            await refreshLoans();
          }}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function positionColor(pos: string): string {
  const map: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)',
    LB: 'var(--color-pos-fb)',
    RB: 'var(--color-pos-fb)',
    LWB: 'var(--color-pos-wb)',
    RWB: 'var(--color-pos-wb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)',
    RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
  };
  return map[pos] ?? 'var(--color-text-muted)';
}

// ── TradeCard ─────────────────────────────────────────────────────────────

export interface TradeCardProps {
  trade: TradeRecord;
  myTeamId: string;
  playerMap: Record<string, SimplePlayer>;
  onAction: (tradeId: string, action: 'accept' | 'reject' | 'cancel') => Promise<void>;
  onCounter: (trade: TradeRecord) => void;
  onViewPlayer?: (player: SimplePlayer) => void;
  error: string;
  loading: boolean;
}

export function TradeCard({ trade, myTeamId, playerMap, onAction, onCounter, onViewPlayer, error, loading }: TradeCardProps) {
  const isProposer = trade.team_a_id === myTeamId;
  const teamAName = (trade.team_a as any)?.team_name ?? 'Team A';
  const teamBName = (trade.team_b as any)?.team_name ?? 'Team B';

  const givePlayers    = isProposer ? trade.offered_players   : trade.requested_players;
  const receivePlayers = isProposer ? trade.requested_players : trade.offered_players;
  const giveFaab       = isProposer ? trade.offered_faab      : trade.requested_faab;
  const receiveFaab    = isProposer ? trade.requested_faab    : trade.offered_faab;
  const counterpartName = isProposer ? teamBName : teamAName;

  const dateStr = new Date(trade.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  function renderPlayer(id: string) {
    const p = playerMap[id];
    if (!p) return (
      <div key={id} className={styles.tcPlayerRow}>
        <span className={styles.tcPosDot} style={{ background: 'var(--color-border)' }} />
        <div className={styles.tcPlayerInfo}>
          <span className={styles.tcPlayerName} style={{ cursor: 'default' }}>Unknown</span>
        </div>
      </div>
    );
    return (
      <div key={id} className={styles.tcPlayerRow}>
        <span className={styles.tcPosDot} style={{ background: positionColor(p.primary_position) }} />
        <div className={styles.tcPlayerInfo}>
          <button className={styles.tcPlayerName} onClick={() => onViewPlayer?.(p)}>
            {getPlayerDisplayName(p, 'initial_last')}
          </button>
          <span className={styles.tcPlayerClub}>{p.pl_team}{p.primary_position ? ` · ${p.primary_position}` : ''}</span>
        </div>
      </div>
    );
  }

  if (trade.status !== 'pending') {
    const statusKey = trade.status as 'accepted' | 'rejected' | 'cancelled';
    const statusCss = statusKey === 'accepted' ? styles.tcHistoryStatusAccepted : styles.tcHistoryStatusRejected;
    return (
      <div className={styles.tcCard}>
        <div className={styles.tcHistoryHeader}>
          <div className={styles.tcHistoryTeams}>
            <span className={styles.tcHistoryTeamName}>{teamAName}</span>
            <span className={styles.tcHistorySwap}>⇄</span>
            <span className={styles.tcHistoryTeamName}>{teamBName}</span>
          </div>
          <div className={styles.tcHistoryMeta}>
            <span className={`${styles.tcHistoryStatus} ${statusCss}`}>{trade.status.toUpperCase()}</span>
            <span className={styles.tcDate}>{dateStr}</span>
          </div>
        </div>
        <div className={styles.tcDeal}>
          <div className={styles.tcSideCol}>
            <span className={styles.tcDealLabel}>{isProposer ? 'You gave' : 'You received'}</span>
            {givePlayers.map(renderPlayer)}
            {giveFaab > 0 && <span className={styles.tcFaabLine}>+ €{giveFaab}m sweetener</span>}
          </div>
          <div className={styles.tcSideCol}>
            <span className={styles.tcDealLabel}>{isProposer ? 'You received' : 'You gave'}</span>
            {receivePlayers.map(renderPlayer)}
            {receiveFaab > 0 && <span className={styles.tcFaabLine}>+ €{receiveFaab}m sweetener</span>}
          </div>
        </div>
        {error && <p className={styles.errorBanner}>{error}</p>}
      </div>
    );
  }

  if (isProposer) {
    return (
      <div className={styles.tcCard}>
        <div className={styles.tcSentHeader}>
          <div>
            <span className={styles.tcKicker}>Outgoing proposal to</span>
            <h3 className={styles.tcTeamName}>{counterpartName}</h3>
          </div>
          <button className={styles.tcCancelLink} onClick={() => onAction(trade.id, 'cancel')} disabled={loading}>
            {loading ? '…' : 'Cancel Proposal'}
          </button>
        </div>
        <div className={styles.tcDeal}>
          <div className={styles.tcSideCol}>
            <span className={styles.tcDealLabel}>You give</span>
            {givePlayers.map(renderPlayer)}
            {giveFaab > 0 && <span className={styles.tcFaabLine}>+ €{giveFaab}m sweetener</span>}
          </div>
          <div className={styles.tcSideCol}>
            <span className={styles.tcDealLabel}>You receive</span>
            {receivePlayers.map(renderPlayer)}
            {receiveFaab > 0 && <span className={styles.tcFaabLine}>+ €{receiveFaab}m sweetener</span>}
          </div>
        </div>
        {trade.message && <p className={styles.tradeMessage}>"{trade.message}"</p>}
        {error && <p className={styles.errorBanner}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.tcCard}>
      <div className={styles.tcIncomingHeader}>
        <div>
          <span className={styles.tcKicker}>From</span>
          <h3 className={styles.tcTeamName}>{counterpartName}</h3>
        </div>
        <div className={styles.tcHeaderMeta}>
          <span className={styles.tcStatusPending}>Pending</span>
          <span className={styles.tcDate}>{dateStr}</span>
        </div>
      </div>
      <div className={styles.tcDeal}>
        <div className={styles.tcSideCol}>
          <span className={styles.tcDealLabel}>You give</span>
          {givePlayers.map(renderPlayer)}
          {giveFaab > 0 && <span className={styles.tcFaabLine}>+ €{giveFaab}m sweetener</span>}
        </div>
        <div className={styles.tcSideCol}>
          <span className={styles.tcDealLabel}>You receive</span>
          {receivePlayers.map(renderPlayer)}
          {receiveFaab > 0 && <span className={styles.tcFaabLine}>+ €{receiveFaab}m sweetener</span>}
        </div>
      </div>
      {trade.message && <p className={styles.tradeMessage}>"{trade.message}"</p>}
      {error && <p className={styles.errorBanner}>{error}</p>}
      <div className={styles.tcActions}>
        <button className={styles.tcAcceptBtn} onClick={() => onAction(trade.id, 'accept')} disabled={loading}>
          {loading ? '…' : 'Accept'}
        </button>
        <button className={styles.tcCounterBtn} onClick={() => onCounter(trade)} disabled={loading}>
          Counter
        </button>
        <button className={styles.tcRejectBtn} onClick={() => onAction(trade.id, 'reject')} disabled={loading}>
          Reject
        </button>
      </div>
    </div>
  );
}

// ── LoanCard ──────────────────────────────────────────────────────────────

function LoanCard({
  loan,
  myTeamId,
  onAction,
  onRecall,
  onSlotBuyback,
  onViewPlayer,
  error,
  loading,
  buybackFee
}: {
  loan: PlayerLoanRecord;
  myTeamId: string;
  onAction: (loanId: string, action: 'accept' | 'reject' | 'cancel') => Promise<void>;
  onRecall: (loanId: string) => Promise<void>;
  onSlotBuyback: (loanId: string) => Promise<void>;
  onViewPlayer: (player: any) => void;
  error: string;
  loading: boolean;
  buybackFee: number;
}) {
  const isLender = loan.lender_team_id === myTeamId;
  const isBorrower = loan.borrower_team_id === myTeamId;
  const proposedBy = loan.proposed_by ?? 'lender';

  const lenderName = loan.lender_team?.team_name ?? 'Lender';
  const borrowerName = loan.borrower_team?.team_name ?? 'Borrower';
  const p = loan.player;

  const dateStr = new Date(loan.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const duration = loan.end_gameweek - loan.start_gameweek;
  const currentAccrued = Math.min(loan.bonus_cap, loan.bonus_points_scored * loan.bonus_rate);

  // Determine direction label
  let directionLabel: string;
  if (proposedBy === 'borrower') {
    directionLabel = isLender ? `Loan Request from ${borrowerName}` : `Your Loan Request to ${lenderName}`;
  } else {
    directionLabel = isLender ? `Loan Out to ${borrowerName}` : `Loan In from ${lenderName}`;
  }

  // Status styling
  let statusText = loan.status.toUpperCase();
  let statusClass = styles.statusPending;
  if (loan.status === 'active') { statusText = 'ACTIVE'; statusClass = styles.statusAccepted; }
  else if (loan.status === 'accepted_deferred') { statusText = 'DEFERRED'; statusClass = styles.statusPending; }
  else if (loan.status === 'pending_activation') { statusText = 'PENDING ACTIVATION'; statusClass = styles.statusPending; }
  else if (['rejected', 'cancelled', 'recalled'].includes(loan.status)) { statusClass = styles.statusRejected; }
  else if (loan.status === 'expired') { statusClass = styles.statusCancelled; }

  // Border color: blue = I'm the lender or I requested, green = I'm the borrower getting a loan
  const borderColor = (isLender && proposedBy === 'lender') || (isBorrower && proposedBy === 'borrower')
    ? 'var(--color-accent-blue)'
    : 'var(--color-accent-green)';

  // Who can action this pending loan?
  const proposerTeamId = proposedBy === 'borrower' ? loan.borrower_team_id : loan.lender_team_id;
  const responderTeamId = proposedBy === 'borrower' ? loan.lender_team_id : loan.borrower_team_id;
  const iAmProposer = proposerTeamId === myTeamId;
  const iAmResponder = responderTeamId === myTeamId;

  return (
    <div className={styles.tcCard} style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderLeft: `4px solid ${borderColor}` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block' }}>
            {directionLabel}
            {proposedBy === 'borrower' && (
              <span style={{ marginLeft: '6px', background: 'rgba(99,135,255,0.15)', color: 'var(--color-accent-blue)', padding: '1px 5px', borderRadius: '3px', fontSize: '8px' }}>
                REQUEST
              </span>
            )}
          </span>
          <h4 style={{ margin: '4px 0 0 0', fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {p ? (
              <button
                onClick={() => onViewPlayer(p)}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textAlign: 'left' }}
              >
                {getPlayerDisplayName(p, 'full')}
              </button>
            ) : 'Unknown Player'}
          </h4>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`${styles.statusTag} ${statusClass}`}>{statusText}</span>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{dateStr}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', background: 'var(--color-bg-elevated)', padding: '12px', borderRadius: '4px' }}>
        <div>
          <span style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Loan Fee</span>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>€{loan.loan_fee}m</span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Duration</span>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{duration} GWs</span>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', display: 'block' }}>GW{loan.start_gameweek}–GW{loan.end_gameweek}</span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Recall Clause</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: loan.has_recall ? 'var(--color-accent-green)' : 'var(--color-text-muted)' }}>
            {loan.has_recall ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Perf. Bonus</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            {loan.bonus_rate > 0 ? `€${loan.bonus_rate}m / pt` : 'None'}
          </span>
          {loan.bonus_rate > 0 && (() => {
            const rate = Number(loan.bonus_rate) || 0;
            const maxPoints = rate > 0 ? loan.bonus_cap / rate : 0;
            const maxAvgPpg = duration > 0 ? maxPoints / duration : 0;
            const baseline = loan.player?.recent_ppg ?? 3.0;
            const headroom = maxAvgPpg - baseline;
            return (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', display: 'block' }}>
                Cap: €{loan.bonus_cap}m (max {maxAvgPpg.toFixed(2)} PPG / +{headroom.toFixed(1)} headroom)
              </span>
            );
          })()}
        </div>
      </div>

      {/* Bonus Tracker */}
      {loan.status === 'active' && loan.bonus_rate > 0 && (
        <div style={{ padding: '8px 12px', background: 'rgba(99,135,255,0.08)', borderLeft: '3px solid var(--color-accent-blue)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block' }}>Performance Tracker</span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Points Scored: {loan.bonus_points_scored} pts</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-accent-green)', display: 'block' }}>Accrued Bonus</span>
            <span style={{ fontSize: '12px', fontWeight: 700 }}>
              €{currentAccrued.toFixed(2)}m
              {currentAccrued >= loan.bonus_cap && <span style={{ fontSize: '9px', color: 'var(--color-accent-red)', marginLeft: '4px' }}>(MAXED)</span>}
            </span>
          </div>
        </div>
      )}

      {loan.message && (
        <p className={styles.tradeMessage} style={{ margin: 0 }}>"{loan.message}"</p>
      )}

      {error && <p className={styles.errorBanner} style={{ margin: 0 }}>{error}</p>}

      {/* Actions for pending loans */}
      {loan.status === 'pending' && iAmResponder && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className={styles.acceptBtn} onClick={() => onAction(loan.id, 'accept')} disabled={loading}
            style={{ fontSize: '12px', padding: '6px 16px' }}>
            {loading ? '…' : 'Accept'}
          </button>
          <button className={styles.rejectBtn} onClick={() => onAction(loan.id, 'reject')} disabled={loading}
            style={{ fontSize: '12px', padding: '6px 16px' }}>
            Reject
          </button>
        </div>
      )}

      {loan.status === 'pending' && iAmProposer && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className={styles.cancelBtn} onClick={() => onAction(loan.id, 'cancel')} disabled={loading}
            style={{ fontSize: '12px', padding: '6px 16px' }}>
            {loading ? '…' : 'Cancel'}
          </button>
        </div>
      )}

      {/* Actions for active loans out (lender) */}
      {loan.status === 'active' && isLender && (
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {!loan.slot_buyback_used ? (
            <button onClick={() => onSlotBuyback(loan.id)} disabled={loading} className={styles.counterBtn}
              style={{ fontSize: '11px', padding: '6px 12px' }}
              title={`Pay €${buybackFee}m to unlock a signing slot during this loan.`}>
              🔑 Buy Back Slot (€{buybackFee}m)
            </button>
          ) : (
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-accent-green)' }}>✓ Slot Bought Back</span>
          )}

          {loan.has_recall && (
            <button
              onClick={() => {
                const penalty = 25;
                if (confirm(`Recall ${p ? getPlayerDisplayName(p, 'full') : 'this player'} early? You will pay €${penalty}m penalty to the borrower.`)) {
                  onRecall(loan.id);
                }
              }}
              disabled={loading} className={styles.rejectBtn}
              style={{ fontSize: '11px', padding: '6px 12px', border: '1px solid var(--color-accent-red)', background: 'none', color: 'var(--color-accent-red)' }}>
              Recall Player
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ListingCard ───────────────────────────────────────────────────────────

function ListingCard({
  listing,
  highestBid,
  isMe,
  leagueId,
  myTeam,
  localMyRoster,
  rosterSize,
  onBidSuccess,
  onProposeTrade,
  onCancelListing,
  onViewPlayer,
}: {
  listing: any;
  highestBid: number;
  isMe: boolean;
  leagueId: string;
  myTeam: any;
  localMyRoster: any[];
  rosterSize: number;
  onBidSuccess: () => void;
  onProposeTrade: () => void;
  onCancelListing: () => void;
  onViewPlayer: (player: any) => void;
}) {
  const p = listing.player;
  const isPending = listing.status === 'pending';
  const isLive = listing.status === 'active';
  const minBid = listing.min_bid;
  const buyNow = listing.buy_now_price;

  const [isBidding, setIsBidding] = useState(false);
  const [bidValue, setBidValue] = useState(isLive ? String(highestBid + 1) : String(minBid));
  const [dropId, setDropId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!isLive || !listing.auction_expires_at) return;
    function updateTimer() {
      const diff = new Date(listing.auction_expires_at).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Ended'); return; }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isLive, listing.auction_expires_at]);

  const activeCount = localMyRoster.filter((r) => r.status !== 'ir' && r.status !== 'taxi').length;
  const showDropSelect = activeCount >= rosterSize;
  const eligibleDrops = localMyRoster.filter((r) => r.status !== 'ir' && r.status !== 'taxi');

  async function handleBid(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const bidNum = parseInt(bidValue, 10);
    if (isNaN(bidNum) || bidNum < 0) { setError('Bid must be a non-negative integer.'); setLoading(false); return; }
    if (isLive && bidNum <= highestBid) { setError(`Bid must beat €${highestBid}m.`); setLoading(false); return; }
    if (bidNum < minBid) { setError(`Minimum bid is €${minBid}m.`); setLoading(false); return; }
    if (bidNum > myTeam.faab_budget) { setError('Insufficient Club Balance.'); setLoading(false); return; }
    if (showDropSelect && !dropId) { setError('Roster full — select a player to drop.'); setLoading(false); return; }

    try {
      const res = await fetch(`/api/leagues/${leagueId}/listings/${listing.id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidAmount: bidNum, dropPlayerId: dropId || undefined }),
      });
      const data = await res.json();
      if (res.ok) { setIsBidding(false); onBidSuccess(); }
      else { setError(data.error ?? 'Failed to place bid.'); }
    } catch { setError('An unexpected error occurred.'); }
    finally { setLoading(false); }
  }

  return (
    <div className={`${styles.tbCard} ${isMe ? styles.tbCardMine : ''}`}>
      <div className={styles.tbCardBody}>
        {p.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo_url} alt={p.name} className={styles.tbPlayerPhoto} />
        ) : (
          <div className={styles.tbPlayerPhotoPlaceholder} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="soccer" size={16} />
          </div>
        )}
        <div className={styles.tbCardInfo}>
          <div className={styles.tbCardInfoTop}>
            <span className={styles.tbPlayerName} style={{ cursor: 'pointer' }} onClick={() => onViewPlayer(p)}>
              {getPlayerDisplayName(p, 'initial_last')}
            </span>
            <div className={styles.tbValueBlock}>
              <span className={styles.tbValueLabel}>{isLive ? 'Current Bid' : 'Min Bid'}</span>
              <span className={styles.tbPlayerValue}>€{isLive ? highestBid : minBid}m</span>
            </div>
          </div>
          <span className={styles.tbPlayerClub}>
            <span className={styles.tcPosDot} style={{ background: positionColor(p.primary_position), margin: 0 }} />
            {p.pl_team} · {p.primary_position}
          </span>
          {buyNow !== null && (
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginTop: '4px' }}>
              Buy Now: €{buyNow}m
            </span>
          )}
          <span className={styles.tbOwnerTag}>
            {isMe ? 'Your Player' : `Listed by ${listing.seller_team?.team_name}`}
          </span>
          {isLive && (
            <span style={{ fontSize: '11px', color: 'var(--color-accent-green)', display: 'block', marginTop: '4px', fontWeight: 'bold' }}>
              ⏳ {timeLeft || 'Auction Live'}
            </span>
          )}
        </div>
      </div>

      {isBidding && (
        <form onSubmit={handleBid} style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {error && <span className={styles.blockToggleError}>{error}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Bid Amount (€m)</label>
            <input
              type="number" min={isLive ? highestBid + 1 : minBid} value={bidValue}
              onChange={(e) => setBidValue(e.target.value)} required
              style={{ padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
            />
          </div>
          {showDropSelect && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Nominate Drop (Roster Full)</label>
              <select value={dropId} onChange={(e) => setDropId(e.target.value)} required
                style={{ padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
                <option value="">— Select player to drop —</option>
                {eligibleDrops.map((d) => (
                  <option key={d.id} value={d.id}>{getPlayerDisplayName(d, 'initial_last')} ({d.primary_position})</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className={styles.blockToggleBtn} onClick={() => setIsBidding(false)} disabled={loading}>Cancel</button>
            <button type="submit" className={styles.blockToggleBtn} style={{ background: 'var(--color-accent-green)', borderColor: 'var(--color-accent-green)', color: '#fff' }} disabled={loading}>
              {loading ? '…' : 'Submit Bid'}
            </button>
          </div>
        </form>
      )}

      {!isBidding && (
        <div className={styles.tbCardAction}>
          {isMe ? (
            isPending ? (
              <button className={styles.tbManageBtn} style={{ background: 'var(--color-accent-red)' }} onClick={onCancelListing}>
                Cancel Listing
              </button>
            ) : (
              <div style={{ padding: '12px', fontSize: '10px', fontWeight: 700, textAlign: 'center', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                🔒 Live Auction — Cannot Cancel
              </div>
            )
          ) : (
            <div style={{ display: 'flex' }}>
              {isPending && (
                <button className={styles.tbProposeBtn} onClick={onProposeTrade} style={{ borderRight: '1px solid var(--color-border-subtle)', flex: 1 }}>
                  Propose Trade
                </button>
              )}
              <button className={styles.tbProposeBtn} onClick={() => setIsBidding(true)} style={{ flex: 1, color: 'var(--color-accent-green)' }}>
                Place Bid
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
