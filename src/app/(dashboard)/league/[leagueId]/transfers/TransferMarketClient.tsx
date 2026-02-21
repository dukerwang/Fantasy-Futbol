'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { AuctionListing, Player, GranularPosition } from '@/types';
import styles from './transfers.module.css';
import PosBadge from '@/components/players/PositionBadge';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';

// ─── Props ─────────────────────────────────────────────────────────────────

interface MyTeamInfo {
  id: string;
  faab_budget: number;
  team_name: string;
}

interface RosterPlayer {
  id: string;
  name: string;
  primary_position: GranularPosition;
  pl_team: string;
}

interface Props {
  leagueId: string;
  leagueName: string;
  initialAuctions: AuctionListing[];
  initialFreeAgents: (Player & { web_name?: string })[];
  initialMyTeam: MyTeamInfo;
  initialMyRoster: RosterPlayer[];
  initialRosterFull: boolean;
}

// ─── Modal state ─────────────────────────────────────────────────────────────

interface ModalState {
  open: boolean;
  player: Player | null;
  currentHighest: number;   // 0 when nominating a free agent
  currentExpiry: string | null;
  myCurrentBid: number | null;
  myCurrentDropId: string | null;
}

// ─── Position badge colours ───────────────────────────────────────────────

const POS_COLOUR: Record<string, string> = {
  GK: '#f59e0b',
  CB: '#3b82f6', LB: '#3b82f6', RB: '#3b82f6',
  DM: '#8b5cf6', CM: '#8b5cf6', AM: '#8b5cf6',
  LW: '#10b981', RW: '#10b981', ST: '#ef4444',
};

// ─── Countdown helper ────────────────────────────────────────────────────

function formatCountdown(expiresAt: string, now: number): string {
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return `${d}d ${remH}h ${m.toString().padStart(2, '0')} m`;
  }
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')} s`;
}

// ─── Main component ───────────────────────────────────────────────────────

export default function TransferMarketClient({
  leagueId,
  leagueName,
  initialAuctions,
  initialFreeAgents,
  initialMyTeam,
  initialMyRoster,
  initialRosterFull,
}: Props) {
  const [auctions, setAuctions] = useState<AuctionListing[]>(initialAuctions);
  const [freeAgents, setFreeAgents] = useState<(Player & { web_name?: string })[]>(initialFreeAgents);
  const [myTeam, setMyTeam] = useState<MyTeamInfo>(initialMyTeam);
  const [myRoster, setMyRoster] = useState<RosterPlayer[]>(initialMyRoster);
  const [rosterFull, setRosterFull] = useState(initialRosterFull);

  // Tick every second for countdown timers
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Search / filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [posFilter, setPosFilter] = useState('');

  // Loading state for refresh
  const [refreshing, setRefreshing] = useState(false);

  // Bidding modal
  const [modal, setModal] = useState<ModalState>({
    open: false,
    player: null,
    currentHighest: 0,
    currentExpiry: null,
    myCurrentBid: null,
    myCurrentDropId: null,
  });
  const [bidAmount, setBidAmount] = useState('');
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);

  // ── Refresh from API ────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/ api / leagues / ${leagueId}/auctions`);
      if (!res.ok) return;
      const data = await res.json();
      setAuctions(data.auctions ?? []);
      setFreeAgents(data.freeAgents ?? []);
      setMyTeam(data.myTeam);
      setMyRoster(data.myRoster ?? []);
      setRosterFull(data.rosterFull ?? false);
    } finally {
      setRefreshing(false);
    }
  }, [leagueId]);

  // ── Modal helpers ───────────────────────────────────────────────────────

  function openBidModal(
    player: Player,
    currentHighest: number,
    currentExpiry: string | null,
    myCurrentBid: number | null,
    myCurrentDropId: string | null,
  ) {
    setModal({ open: true, player, currentHighest, currentExpiry, myCurrentBid, myCurrentDropId });
    setBidAmount(String(Math.max(currentHighest + 1, myCurrentBid !== null ? myCurrentBid + 1 : 0)));
    setDropPlayerId(myCurrentDropId ?? '');
    setSubmitError('');
  }

  function closeModal() {
    setModal((m) => ({ ...m, open: false, player: null }));
    setBidAmount('');
    setDropPlayerId('');
    setSubmitError('');
    setSubmitting(false);
  }

  // ── Bid submission ──────────────────────────────────────────────────────

  async function handleSubmitBid() {
    if (!modal.player) return;
    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount < 0) {
      setSubmitError('Enter a valid bid amount.');
      return;
    }
    if (amount > myTeam.faab_budget) {
      setSubmitError(`You only have £${myTeam.faab_budget}m FAAB remaining.`);
      return;
    }
    if (rosterFull && !dropPlayerId) {
      setSubmitError('Your roster is full — select a player to drop.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    const res = await fetch(`/api/leagues/${leagueId}/auctions/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: modal.player.id,
        bidAmount: amount,
        dropPlayerId: dropPlayerId || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setSubmitError(data.error ?? 'Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }

    closeModal();
    await refresh();
  }

  // ── Derived: filtered free agents ───────────────────────────────────────

  const filteredAgents = freeAgents.filter((p) => {
    const matchesPos = !posFilter || p.primary_position === posFilter;
    const matchesQ =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.web_name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPos && matchesQ;
  });

  const positions = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href={`/league/${leagueId}`}>{leagueName}</Link> / Transfer Market
          </p>
          <h1 className={styles.title}>Transfer Market</h1>
          <p className={styles.subtitle}>
            Public FAAB auctions · 48-hour timer · Anti-snipe: bids in the final hour reset clock to 1h
          </p>
        </div>
        <div className={styles.faabBadge}>
          <span className={styles.faabLabel}>Your FAAB</span>
          <span className={styles.faabAmount}>£{myTeam.faab_budget}m</span>
        </div>
      </header>

      <div className={styles.layout}>
        {/* ── Left: Active Auctions ── */}
        <section className={styles.auctionsPanel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Active Auctions</h2>
            <button
              className={styles.refreshBtn}
              onClick={refresh}
              disabled={refreshing}
              title="Refresh"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>

          {auctions.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No active auctions.</p>
              <p className={styles.emptyHint}>Nominate a free agent below to kick one off.</p>
            </div>
          ) : (
            <div className={styles.auctionList}>
              {auctions.map((auction) => {
                const isUrgent = new Date(auction.expires_at).getTime() - now < ANTI_SNIPE_WINDOW_MS;
                const isLeading = auction.highest_bidder_team_id === myTeam.id;
                const isBidding = auction.my_bid !== null && !isLeading;

                return (
                  <div
                    key={auction.player.id}
                    className={`${styles.auctionCard} ${isUrgent ? styles.auctionCardUrgent : ''}`}
                  >
                    {/* Player info */}
                    <div className={styles.auctionCardTop}>
                      <div className={styles.playerInfo}>
                        <PosBadge position={auction.player.primary_position} />
                        <div>
                          <button
                            type="button"
                            className={styles.playerName}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline', color: 'inherit' }}
                            onClick={() => setViewingPlayer(auction.player)}
                            title="View Player Details"
                          >
                            {auction.player.web_name ?? auction.player.name}
                          </button>
                          <span className={styles.playerClub}>{auction.player.pl_team}</span>
                        </div>
                      </div>
                      {/* Countdown */}
                      <div className={`${styles.countdown} ${isUrgent ? styles.countdownUrgent : ''}`}>
                        <span className={styles.countdownIcon}>{isUrgent ? '🔥' : '⏱'}</span>
                        {formatCountdown(auction.expires_at, now)}
                      </div>
                    </div>

                    {/* Bid status */}
                    <div className={styles.auctionCardMid}>
                      <div className={styles.bidBlock}>
                        <span className={styles.bidBlockLabel}>Leading bid</span>
                        <span className={styles.bidBlockValue}>
                          £{auction.highest_bid}m
                          {isLeading && (
                            <span className={styles.youLeadTag}> · You</span>
                          )}
                        </span>
                        <span className={styles.bidBlockTeam}>
                          {isLeading ? myTeam.team_name : auction.highest_bidder_team_name}
                        </span>
                      </div>

                      <div className={styles.bidBlock}>
                        <span className={styles.bidBlockLabel}>
                          {auction.bid_count === 1 ? '1 bid' : `${auction.bid_count} bids`}
                        </span>
                        {auction.my_bid !== null && !isLeading && (
                          <>
                            <span className={styles.bidBlockValue}>My bid: £{auction.my_bid}m</span>
                            <span className={styles.outbidTag}>Outbid</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    <button
                      className={`${styles.bidBtn} ${isLeading ? styles.bidBtnLeading : ''} ${isBidding ? styles.bidBtnOutbid : ''}`}
                      onClick={() =>
                        openBidModal(
                          auction.player,
                          auction.highest_bid,
                          auction.expires_at,
                          auction.my_bid,
                          auction.my_drop_player_id,
                        )
                      }
                    >
                      {isLeading ? 'Raise Bid' : isBidding ? 'Counter Bid' : 'Place Bid'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Right: Free Agents ── */}
        <section className={styles.freeAgentsPanel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Available Players</h2>
          </div>

          {/* Filters */}
          <div className={styles.filters}>
            <input
              className={styles.searchInput}
              placeholder="Search player…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className={styles.posFilters}>
              <button
                className={`${styles.posFilter} ${!posFilter ? styles.posFilterActive : ''}`}
                onClick={() => setPosFilter('')}
              >
                All
              </button>
              {positions.map((p) => (
                <button
                  key={p}
                  className={`${styles.posFilter} ${posFilter === p ? styles.posFilterActive : ''}`}
                  onClick={() => setPosFilter(posFilter === p ? '' : p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <p className={styles.resultCount}>
            {filteredAgents.length} player{filteredAgents.length !== 1 ? 's' : ''} available
          </p>

          <div className={styles.agentList}>
            {filteredAgents.length === 0 ? (
              <p className={styles.emptyState}>No players match your search.</p>
            ) : (
              filteredAgents.map((player) => (
                <div key={player.id} className={styles.agentRow}>
                  <PosBadge position={player.primary_position} />
                  <div className={styles.agentInfoTop}>
                    <button
                      type="button"
                      className={styles.agentName}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline', color: 'inherit' }}
                      onClick={() => setViewingPlayer(player)}
                      title="View Player Details"
                    >
                      {player.web_name ?? player.name}
                    </button>
                    <span className={styles.agentValue}>£{Number(player.market_value ?? 0).toFixed(1)}m</span>
                  </div>
                  <button
                    className={styles.nominateBtn}
                    onClick={() => openBidModal(player, 0, null, null, null)}
                  >
                    Nominate
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Bid Modal ── */}
      {modal.open && modal.player && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={closeModal}>×</button>

            {/* Player header */}
            <div className={styles.modalPlayerHeader}>
              <PosBadge position={modal.player.primary_position} />
              <div>
                <h2 className={styles.modalPlayerName}>
                  {modal.player.web_name ?? modal.player.name}
                </h2>
                <p className={styles.modalPlayerClub}>{modal.player.pl_team}</p>
              </div>
            </div>

            {/* Auction context */}
            {modal.currentExpiry ? (
              <div className={styles.modalAuctionInfo}>
                <div className={styles.modalInfoRow}>
                  <span>Current highest bid</span>
                  <strong>£{modal.currentHighest}m</strong>
                </div>
                {modal.myCurrentBid !== null && (
                  <div className={styles.modalInfoRow}>
                    <span>Your current bid</span>
                    <strong>£{modal.myCurrentBid}m</strong>
                  </div>
                )}
                <div className={styles.modalInfoRow}>
                  <span>Auction closes</span>
                  <strong>{formatCountdown(modal.currentExpiry, now)}</strong>
                </div>
              </div>
            ) : (
              <div className={styles.modalAuctionInfo}>
                <p className={styles.nominateHint}>
                  You are the first to bid — this will start a 48-hour auction.
                </p>
              </div>
            )}

            {/* FAAB remaining */}
            <div className={styles.modalFaab}>
              Your FAAB: <strong>£{myTeam.faab_budget}m</strong>
            </div>

            {/* Bid input */}
            <label className={styles.modalLabel}>
              Your bid (£m)
              <input
                type="number"
                min={0}
                max={myTeam.faab_budget}
                step={1}
                className={styles.modalInput}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                autoFocus
              />
            </label>
            <p className={styles.modalHint}>
              Minimum:{' '}
              <strong>
                £{modal.myCurrentBid !== null
                  ? Math.max(modal.currentHighest, modal.myCurrentBid) + 1
                  : modal.currentHighest}m
              </strong>
            </p>

            {/* Drop player selector */}
            {rosterFull && (
              <label className={styles.modalLabel}>
                Drop player (roster full)
                <select
                  className={styles.modalSelect}
                  value={dropPlayerId}
                  onChange={(e) => setDropPlayerId(e.target.value)}
                >
                  <option value="">— Select player to drop —</option>
                  {myRoster.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.primary_position} · {p.pl_team})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Error */}
            {submitError && <p className={styles.modalError}>{submitError}</p>}

            {/* Actions */}
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              <button
                className={styles.submitBtn}
                onClick={handleSubmitBid}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : modal.currentExpiry ? 'Submit Bid' : 'Start Auction'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PlayerDetailsModal
        player={viewingPlayer}
        onClose={() => setViewingPlayer(null)}
      />
    </div>
  );
}

// Reuse the constant from the bid API (1 hour in ms)
const ANTI_SNIPE_WINDOW_MS = 60 * 60 * 1_000;
