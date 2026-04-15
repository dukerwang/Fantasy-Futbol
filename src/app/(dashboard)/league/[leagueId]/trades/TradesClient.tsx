'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import PositionBadge from '@/components/players/PositionBadge';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import AddToBlockModal from './AddToBlockModal';
import { formatPlayerName } from '@/lib/formatName';
import styles from './trades.module.css';

interface SimplePlayer {
  id: string;
  name: string;
  web_name: string | null;
  full_name?: string | null;
  pl_team?: string | null;
  projected_points?: number | null;
  market_value?: number | null;
  primary_position: string;
  on_trade_block?: boolean;
}

interface SimpleTeam {
  id: string;
  team_name: string;
  faab_budget: number;
}

interface TradeRecord {
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

interface Props {
  leagueId: string;
  leagueName: string;
  myTeam: SimpleTeam;
  myRoster: SimplePlayer[];
  allTeams: SimpleTeam[];
  allTeamsIncludingMine: SimpleTeam[];
  allRosters: Record<string, SimplePlayer[]>;
  initialTrades: TradeRecord[];
  leagueTrades: any[];
  initialPlayerMap: Record<string, SimplePlayer>;
}

type Tab = 'my-trades' | 'propose' | 'league-feed' | 'trade-block';

function playerDisplayName(p: SimplePlayer) {
  return formatPlayerName(p, 'initial_last');
}

export default function TradesClient({
  leagueId,
  leagueName,
  myTeam,
  myRoster,
  allTeams,
  allTeamsIncludingMine,
  allRosters,
  initialTrades,
  leagueTrades,
  initialPlayerMap,
}: Props) {
  const [tab, setTab] = useState<Tab>('my-trades');
  const [trades, setTrades] = useState<TradeRecord[]>(initialTrades);
  const [playerMap, setPlayerMap] = useState<Record<string, SimplePlayer>>(initialPlayerMap);
  const [viewingPlayer, setViewingPlayer] = useState<SimplePlayer | null>(null);
  const [localMyRoster, setLocalMyRoster] = useState<SimplePlayer[]>(myRoster);
  const [showBlockModal, setShowBlockModal] = useState(false);

  // Propose Trade state
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

  // ── Trade action (accept / reject / cancel) ──────────────────────────────

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

    // Refresh trade list
    const refreshRes = await fetch(`/api/leagues/${leagueId}/trades`);
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      setTrades(refreshData.trades ?? []);
      setPlayerMap((prev) => ({ ...prev, ...refreshData.playerMap }));
    }
    setActionLoading((prev) => ({ ...prev, [tradeId]: false }));
  }, [leagueId]);

  // ── Counter Offer ────────────────────────────────────────────────────────

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
    setTab('propose');
    setProposeSuccess('');
  }, [myTeam.id]);

  // ── Propose trade submission ─────────────────────────────────────────────

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
      setProposeError(`You only have £${myTeam.faab_budget}m FAAB — cannot offer £${offFaab}m.`); return;
    }
    if (targetTeam && reqFaab > targetTeam.faab_budget) {
      setProposeError(`${targetTeam.team_name} only has £${targetTeam.faab_budget}m FAAB — cannot request £${reqFaab}m.`); return;
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

    setOfferedPlayerIds(new Set());
    setRequestedPlayerIds(new Set());
    setOfferedFaab('0');
    setRequestedFaab('0');
    setTradeMessage('');
    setSelectedTeamId('');
    setParentTradeId(null);
    setProposeSuccess('Trade proposal sent!');

    const refreshRes = await fetch(`/api/leagues/${leagueId}/trades`);
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      setTrades(refreshData.trades ?? []);
      setPlayerMap((prev) => ({ ...prev, ...refreshData.playerMap }));
    }

    setSubmitting(false);
    setTab('my-trades');
  }, [leagueId, selectedTeamId, offeredPlayerIds, requestedPlayerIds, offeredFaab, requestedFaab, tradeMessage, parentTradeId, myTeam, targetTeam]);

  // ── Toggle player selection ──────────────────────────────────────────────

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

  // ── Trade block local update ──────────────────────────────────────────────

  function handleBlockToggle(playerId: string, isOnBlock: boolean) {
    setLocalMyRoster((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, on_trade_block: isOnBlock } : p))
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const pendingTrades = trades.filter((t) => t.status === 'pending');
  const incomingTrades = pendingTrades.filter((t) => t.team_b_id === myTeam.id);
  const sentTrades = pendingTrades.filter((t) => t.team_a_id === myTeam.id);
  const pastTrades = trades.filter((t) => t.status !== 'pending');

  const myOnBlock = localMyRoster.filter((p) => p.on_trade_block);
  const othersOnBlock = Object.entries(allRosters).flatMap(([teamId, roster]) =>
    roster.filter((p) => p.on_trade_block).map((p) => ({ ...p, team_id: teamId }))
  );
  const allBlockPlayers = [
    ...myOnBlock.map((p) => ({ ...p, team_id: myTeam.id })),
    ...othersOnBlock,
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href={`/league/${leagueId}`}>{leagueName}</Link> / Trades
          </p>
          <h1 className={styles.title}>Trades</h1>
          {pendingTrades.length > 0 && (
            <p className={styles.pendingHint}>
              {incomingTrades.length > 0
                ? `${incomingTrades.length} incoming proposal${incomingTrades.length > 1 ? 's' : ''} awaiting your response`
                : `${sentTrades.length} proposal${sentTrades.length > 1 ? 's' : ''} awaiting response`}
            </p>
          )}
        </div>
        <div className={styles.faabBadge}>
          <span className={styles.faabLabel}>Your FAAB</span>
          <span className={styles.faabAmount}>£{myTeam.faab_budget}m</span>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'my-trades' ? styles.tabActive : ''}`}
          onClick={() => setTab('my-trades')}
        >
          My Trades
          {pendingTrades.length > 0 && (
            <span className={styles.tabBadge}>{pendingTrades.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${tab === 'propose' ? styles.tabActive : ''}`}
          onClick={() => { setTab('propose'); setProposeSuccess(''); }}
        >
          Propose a Trade
        </button>
        <button
          className={`${styles.tab} ${tab === 'league-feed' ? styles.tabActive : ''}`}
          onClick={() => setTab('league-feed')}
        >
          League Feed
        </button>
        <button
          className={`${styles.tab} ${tab === 'trade-block' ? styles.tabActive : ''}`}
          onClick={() => { setTab('trade-block'); setProposeSuccess(''); }}
        >
          Trade Block
        </button>
      </div>

      {/* ── My Trades Tab ── */}
      {tab === 'my-trades' && (
        <div className={styles.tradesSection}>
          {proposeSuccess && (
            <div className={styles.successBanner}>{proposeSuccess}</div>
          )}

          {trades.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No trades yet.</p>
              <button className={styles.proposeBtn} onClick={() => setTab('propose')}>
                Propose a Trade
              </button>
            </div>
          ) : (
            <>
              {/* Incoming */}
              {incomingTrades.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader}>
                    <span className={styles.tradeSubGroupIcon}>↙</span>
                    <h2 className={styles.tradeGroupTitle}>Incoming</h2>
                    <span className={styles.tradeSubGroupHint}>Awaiting your response</span>
                  </div>
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
              )}

              {/* Sent */}
              {sentTrades.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader}>
                    <span className={styles.tradeSubGroupIcon}>↗</span>
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

              {/* No pending but there are trades */}
              {pendingTrades.length === 0 && (
                <p className={styles.noPendingHint}>
                  No active proposals.{' '}
                  <button className={styles.inlineLinkBtn} onClick={() => setTab('propose')}>
                    Propose one →
                  </button>
                </p>
              )}

              {/* History */}
              {pastTrades.length > 0 && (
                <div className={styles.tradeGroup}>
                  <div className={styles.tradeSubGroupHeader}>
                    <span className={styles.tradeSubGroupIcon}>◷</span>
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
        </div>
      )}

      {/* ── Propose Trade Tab ── */}
      {tab === 'propose' && (
        <div className={styles.proposeSection}>
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
                  {t.team_name} (£{t.faab_budget}m FAAB)
                </option>
              ))}
            </select>
          </div>

          {/* Split-screen rosters */}
          {selectedTeamId && (
            <>
              <div className={styles.splitScreen}>
                {/* My Roster (left) */}
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
                            className={styles.tradePlayerNameLink}
                          >
                            {playerDisplayName(p)}
                          </span>
                          <span className={styles.rosterPlayerClub}>
                            {p.pl_team}
                            {p.projected_points !== undefined && p.projected_points !== null && (
                              <span style={{ color: 'var(--color-text-secondary)', marginLeft: '8px' }}>Proj: {Number(p.projected_points).toFixed(1)}</span>
                            )}
                          </span>
                          {offeredPlayerIds.has(p.id) && <span className={styles.checkmark}>✓</span>}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Target Roster (right) */}
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
                            className={styles.tradePlayerNameLink}
                          >
                            {playerDisplayName(p)}
                          </span>
                          <span className={styles.rosterPlayerClub}>
                            {p.pl_team}
                            {p.projected_points !== undefined && p.projected_points !== null && (
                              <span style={{ color: 'var(--color-text-secondary)', marginLeft: '8px' }}>Proj: {Number(p.projected_points).toFixed(1)}</span>
                            )}
                          </span>
                          {requestedPlayerIds.has(p.id) && <span className={styles.checkmark}>✓</span>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Trade Proposal Dock */}
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
                          <div className={styles.dockFaab}>+ £{offeredFaab}m FAAB</div>
                        )}
                      </>
                    )}
                    <div className={styles.faabInput}>
                      <label className={styles.fieldLabel}>Include FAAB (£m):</label>
                      <input
                        type="number"
                        min={0}
                        max={myTeam.faab_budget}
                        step={1}
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
                          <div className={styles.dockFaab}>+ £{requestedFaab}m FAAB</div>
                        )}
                      </>
                    )}
                    <div className={styles.faabInput}>
                      <label className={styles.fieldLabel}>Request FAAB (£m):</label>
                      <input
                        type="number"
                        min={0}
                        max={targetTeam?.faab_budget ?? 0}
                        step={1}
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
                    onClick={() => {
                      setOfferedPlayerIds(new Set());
                      setRequestedPlayerIds(new Set());
                      setOfferedFaab('0');
                      setRequestedFaab('0');
                      setTradeMessage('');
                      setProposeError('');
                      setParentTradeId(null);
                    }}
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
      )}

      {/* ── League Feed Tab ── */}
      {tab === 'league-feed' && (
        <div className={styles.tradesSection}>
          <div className={styles.leagueFeedHeader}>
            <span className={styles.leagueFeedLabel}>SEASON-LONG TRADES</span>
            <h2 className={styles.tradeGroupTitle}>League Trade Feed</h2>
            <p className={styles.leagueFeedSubtitle}>
              All completed trades across the league, most recent first.
            </p>
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
                    {/* Header row */}
                    <div className={styles.leagueFeedRowHeader}>
                      <div className={styles.leagueFeedTeams}>
                        <span className={`${styles.leagueFeedTeamName} ${trade.team_a_id === myTeam.id ? styles.myTeamHighlight : ''}`}>
                          {teamAName}
                        </span>
                        <span className={styles.leagueFeedSwap}>⇄</span>
                        <span className={`${styles.leagueFeedTeamName} ${trade.team_b_id === myTeam.id ? styles.myTeamHighlight : ''}`}>
                          {teamBName}
                        </span>
                        {isInvolved && <span className={styles.leagueFeedMineTag}>YOUR DEAL</span>}
                      </div>
                      <div className={styles.leagueFeedRowMeta}>
                        <span className={styles.leagueFeedStatus}>COMPLETED</span>
                        <span className={styles.leagueFeedDate}>
                          {new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    {/* Players exchanged */}
                    <div className={styles.leagueFeedDeal}>
                      <div className={styles.leagueFeedSide}>
                        <span className={styles.leagueFeedSideLabel}>{teamAName} sent:</span>
                        <div className={styles.leagueFeedPlayers}>
                          {offeredPlayers.length > 0 ? offeredPlayers.map((p: SimplePlayer) => (
                            <span key={p.id} className={styles.leagueFeedPlayerChip}>
                              <span
                                className={styles.leagueFeedPosBadge}
                                style={{ background: positionColor(p.primary_position) }}
                              >
                                {p.primary_position}
                              </span>
                              {p.web_name ?? p.name}
                            </span>
                          )) : <span className={styles.leagueFeedNone}>—</span>}
                          {trade.offered_faab > 0 && (
                            <span className={styles.leagueFeedFaab}>+£{trade.offered_faab}m</span>
                          )}
                        </div>
                      </div>
                      <div className={styles.leagueFeedSide}>
                        <span className={styles.leagueFeedSideLabel}>{teamBName} sent:</span>
                        <div className={styles.leagueFeedPlayers}>
                          {requestedPlayers.length > 0 ? requestedPlayers.map((p: SimplePlayer) => (
                            <span key={p.id} className={styles.leagueFeedPlayerChip}>
                              <span
                                className={styles.leagueFeedPosBadge}
                                style={{ background: positionColor(p.primary_position) }}
                              >
                                {p.primary_position}
                              </span>
                              {p.web_name ?? p.name}
                            </span>
                          )) : <span className={styles.leagueFeedNone}>—</span>}
                          {trade.requested_faab > 0 && (
                            <span className={styles.leagueFeedFaab}>+£{trade.requested_faab}m</span>
                          )}
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

      {/* ── Trade Block Tab ── */}
      {tab === 'trade-block' && (
        <div className={styles.tradesSection}>
          <div className={styles.tradeBlockSectionHeader}>
            <div>
              <span className={styles.leagueFeedLabel}>AVAILABLE FOR DEALS</span>
              <h2 className={styles.tradeGroupTitle}>Trade Block</h2>
              <p className={styles.leagueFeedSubtitle}>
                Players whose managers have signalled they're open to offers.
              </p>
            </div>
            <button
              className={styles.addToBlockBtn}
              onClick={() => setShowBlockModal(true)}
            >
              + Manage My Block
            </button>
          </div>

          {allBlockPlayers.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No players are currently on the trade block.</p>
              <button className={styles.proposeBtn} onClick={() => setShowBlockModal(true)}>
                Add your players
              </button>
            </div>
          ) : (
            <div className={styles.tradeBlockGrid}>
              {allBlockPlayers.map((p, i) => {
                const isMe = p.team_id === myTeam.id;
                const teamName = isMe
                  ? myTeam.team_name
                  : (allTeamsIncludingMine.find((t) => t.id === p.team_id)?.team_name ?? 'Unknown Team');
                return (
                  <div
                    key={`${p.id}-${i}`}
                    className={`${styles.tradeBlockCard} ${isMe ? styles.tradeBlockCardMine : ''}`}
                    style={{ borderLeftColor: positionColor(p.primary_position) }}
                  >
                    <div className={styles.tradeBlockCardInner}>
                      <PositionBadge position={p.primary_position as any} size="sm" />
                      <div className={styles.tradeBlockCardInfo}>
                        <span className={styles.tradeBlockCardName}>
                          {playerDisplayName(p)}
                        </span>
                        <span className={styles.tradeBlockCardClub}>
                          {p.pl_team} {p.market_value ? `· £${p.market_value.toFixed(1)}m` : ''}
                        </span>
                        <span className={`${styles.tradeBlockCardOwner} ${isMe ? styles.tradeBlockCardOwnerMe : ''}`}>
                          {isMe ? '★ YOUR PLAYER' : `Owned by ${teamName}`}
                        </span>
                      </div>
                    </div>
                    <div className={styles.tradeBlockCardActions}>
                      {isMe ? (
                        <button
                          className={styles.removeFromBlockBtn}
                          onClick={() => setShowBlockModal(true)}
                        >
                          Manage
                        </button>
                      ) : (
                        <button
                          className={styles.proposeTradeQuickBtn}
                          onClick={() => {
                            setSelectedTeamId(p.team_id);
                            setOfferedPlayerIds(new Set());
                            setRequestedPlayerIds(new Set([p.id]));
                            setTab('propose');
                          }}
                        >
                          Propose Trade
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <PlayerDetailsModal
        player={viewingPlayer as any}
        onClose={() => setViewingPlayer(null)}
      />

      {showBlockModal && (
        <AddToBlockModal
          myTeamId={myTeam.id}
          myRoster={localMyRoster}
          onClose={() => setShowBlockModal(false)}
          onToggle={handleBlockToggle}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function positionColor(pos: string): string {
  const map: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)', LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)', LM: 'var(--color-pos-cm)', RM: 'var(--color-pos-cm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
  };
  return map[pos] ?? 'var(--color-text-muted)';
}

// ── TradeCard sub-component ───────────────────────────────────────────────

interface TradeCardProps {
  trade: TradeRecord;
  myTeamId: string;
  playerMap: Record<string, SimplePlayer>;
  onAction: (tradeId: string, action: 'accept' | 'reject' | 'cancel') => Promise<void>;
  onCounter: (trade: TradeRecord) => void;
  onViewPlayer?: (player: SimplePlayer) => void;
  error: string;
  loading: boolean;
}

function TradeCard({ trade, myTeamId, playerMap, onAction, onCounter, onViewPlayer, error, loading }: TradeCardProps) {
  const isProposer = trade.team_a_id === myTeamId;
  const teamAName = (trade.team_a as any)?.team_name ?? 'Team A';
  const teamBName = (trade.team_b as any)?.team_name ?? 'Team B';

  const statusClass: Record<string, string> = {
    pending: styles.statusPending,
    accepted: styles.statusAccepted,
    rejected: styles.statusRejected,
    cancelled: styles.statusCancelled,
  };

  function renderPlayers(ids: string[], label: string) {
    if (ids.length === 0) return null;
    return (
      <div className={styles.tradePlayerGroup}>
        <span className={styles.tradeGroupLabel}>{label}</span>
        {ids.map((id) => {
          const p = playerMap[id];
          return p ? (
            <div key={id} className={styles.tradePlayerRow}>
              <PositionBadge position={p.primary_position as any} size="sm" />
              <button
                className={styles.tradePlayerNameBtn}
                onClick={() => onViewPlayer?.(p)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text)',
                  fontWeight: 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  padding: 0,
                  textAlign: 'left',
                }}
              >
                {formatPlayerName(p, 'initial_last')}
              </button>
              <span className={styles.tradePlayerClub}>{p.pl_team}</span>
            </div>
          ) : (
            <div key={id} className={styles.tradePlayerRow}>
              <span className={styles.unknownPlayer}>Unknown player</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.tradeCard}>
      <div className={styles.tradeCardHeader}>
        <div className={styles.tradeCardTeams}>
          <span className={styles.tradeTeamA}>{teamAName}</span>
          <span className={styles.tradeVs}>⇄</span>
          <span className={styles.tradeTeamB}>{teamBName}</span>
        </div>
        <div className={styles.tradeCardMeta}>
          <span className={`${styles.statusTag} ${statusClass[trade.status]}`}>
            {trade.status.toUpperCase()}
          </span>
          <span className={styles.tradeDate}>
            {new Date(trade.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className={styles.tradeDeal}>
        <div className={styles.tradeSide}>
          {renderPlayers(trade.offered_players, `${teamAName} offers:`)}
          {trade.offered_faab > 0 && (
            <div className={styles.tradeFaabRow}>
              <span>+ £{trade.offered_faab}m FAAB</span>
            </div>
          )}
        </div>
        <div className={styles.tradeSide}>
          {renderPlayers(trade.requested_players, `${teamBName} offers:`)}
          {trade.requested_faab > 0 && (
            <div className={styles.tradeFaabRow}>
              <span>+ £{trade.requested_faab}m FAAB</span>
            </div>
          )}
        </div>
      </div>

      {trade.message && (
        <p className={styles.tradeMessage}>"{trade.message}"</p>
      )}

      {error && <p className={styles.errorBanner}>{error}</p>}

      {trade.status === 'pending' && (
        <div className={styles.tradeCardActions}>
          {isProposer ? (
            <button
              className={styles.cancelBtn}
              onClick={() => onAction(trade.id, 'cancel')}
              disabled={loading}
            >
              Cancel Proposal
            </button>
          ) : (
            <>
              <button
                onClick={() => onAction(trade.id, 'reject')}
                disabled={loading}
              >
                {loading ? '…' : 'Reject'}
              </button>
              <button
                className={styles.counterBtn}
                onClick={() => onCounter(trade)}
                disabled={loading}
              >
                Counter Offer
              </button>
              <button
                className={styles.acceptBtn}
                onClick={() => onAction(trade.id, 'accept')}
                disabled={loading}
              >
                {loading ? '…' : 'Accept Trade'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
