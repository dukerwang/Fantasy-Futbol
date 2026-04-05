'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { AuctionListing, Player, GranularPosition } from '@/types';
import { formatPlayerName } from '@/lib/formatName';
import styles from './transfers.module.css';
import PosBadge from '@/components/players/PositionBadge';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  market_value?: number | null;
}

interface RecentActivityItem {
  id: string;
  type: string;
  faab_bid: number | null;
  processed_at: string;
  team: { id: string; team_name: string } | null;
  player: { id: string; web_name: string | null; name: string; primary_position: string; pl_team: string } | null;
}

interface Props {
  leagueId: string;
  initialAuctions: AuctionListing[];
  initialFreeAgents: (Player & { web_name?: string })[];
  initialMyTeam: MyTeamInfo;
  initialMyRoster: RosterPlayer[];
  initialRosterFull: boolean;
  initialRecentActivity: RecentActivityItem[];
}

// ─── Modal state ─────────────────────────────────────────────────────────────

interface ModalState {
  open: boolean;
  player: Player | null;
  currentHighest: number;
  currentExpiry: string | null;
  myCurrentBid: number | null;
  myCurrentDropId: string | null;
  bidHistory: AuctionListing['bid_history'];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(expiresAt: string, now: number): string {
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
}

function formatEndTime(expiresAt: string): string {
  const date = new Date(expiresAt);
  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
  if (date.toDateString() === todayStr) return `Ends today at ${timeStr}`;
  if (date.toDateString() === tomorrowStr) return `Ends tomorrow at ${timeStr}`;
  return `Ends ${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatStat(val: number | null | undefined, decimals = 1): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

function formatMarketValue(val: number | null | undefined): string {
  if (val == null) return '—';
  return `£${Number(val).toFixed(0)}M`;
}

const ANTI_SNIPE_WINDOW_MS = 60 * 60 * 1_000;

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransferMarketClient({
  leagueId,
  initialAuctions,
  initialFreeAgents,
  initialMyTeam,
  initialMyRoster,
  initialRosterFull,
  initialRecentActivity,
}: Props) {
  const [auctions, setAuctions] = useState<AuctionListing[]>(initialAuctions);
  // Full unfiltered list — refreshed from API; search filters client-side
  const [allFreeAgents, setAllFreeAgents] = useState<(Player & { web_name?: string })[]>(initialFreeAgents);
  const [myTeam, setMyTeam] = useState<MyTeamInfo>(initialMyTeam);
  const [myRoster, setMyRoster] = useState<RosterPlayer[]>(initialMyRoster);
  const [rosterFull, setRosterFull] = useState(initialRosterFull);
  const [activeTab, setActiveTab] = useState<'market' | 'auctions'>('market');

  // Client-side search/filter state
  const [searchQ, setSearchQ] = useState('');
  const [searchPos, setSearchPos] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const [modal, setModal] = useState<ModalState>({
    open: false,
    player: null,
    currentHighest: 0,
    currentExpiry: null,
    myCurrentBid: null,
    myCurrentDropId: null,
    bidHistory: [],
  });
  const [bidAmount, setBidAmount] = useState('');
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);

  // ── Client-side filtering ────────────────────────────────────────────────────

  const freeAgents = useMemo(() => {
    let list = allFreeAgents;
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.web_name ?? '').toLowerCase().includes(q) ||
          (p.pl_team ?? '').toLowerCase().includes(q),
      );
    }
    if (searchPos) {
      list = list.filter(
        (p) =>
          p.primary_position === searchPos ||
          (p.secondary_positions ?? []).includes(searchPos as any),
      );
    }
    return list;
  }, [allFreeAgents, searchQ, searchPos]);

  // ── Refresh ─────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/auctions`);
      if (!res.ok) return;
      const data = await res.json();
      setAuctions(data.auctions ?? []);
      setAllFreeAgents(data.freeAgents ?? []); // preserve searchQ/searchPos
      setMyTeam(data.myTeam);
      setMyRoster(data.myRoster ?? []);
      setRosterFull(data.rosterFull ?? false);
    } finally {
      setRefreshing(false);
    }
  }, [leagueId]);

  // ── Modal ───────────────────────────────────────────────────────────────────

  function openBidModal(
    player: Player,
    currentHighest: number,
    currentExpiry: string | null,
    myCurrentBid: number | null,
    myCurrentDropId: string | null,
    bidHistory: AuctionListing['bid_history'] = [],
  ) {
    setModal({ open: true, player, currentHighest, currentExpiry, myCurrentBid, myCurrentDropId, bidHistory });
    const tmMin = Math.floor(Number(player.market_value || 0) * 0.2);
    const auctionMin = myCurrentBid !== null
      ? Math.max(currentHighest, myCurrentBid) + 1
      : currentHighest;
    setBidAmount(String(Math.max(auctionMin, tmMin)));
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

  // ── Bid submission ──────────────────────────────────────────────────────────

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
    const tmMin = Math.floor(Number(modal.player.market_value || 0) * 0.2);
    if (tmMin > 0 && amount < tmMin) {
      setSubmitError(`Minimum bid for this player is £${tmMin}m (Transfermarkt floor).`);
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

  // ── Search ──────────────────────────────────────────────────────────────────

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setSearchQ((formData.get('q') as string) ?? '');
  }

  const positions = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'ST'];

  // ── Bid stepper ─────────────────────────────────────────────────────────────

  const bidNum = parseInt(bidAmount, 10);
  const tmMin = modal.player ? Math.floor(Number(modal.player.market_value || 0) * 0.2) : 0;
  const auctionMin = modal.myCurrentBid !== null
    ? Math.max(modal.currentHighest, modal.myCurrentBid) + 1
    : modal.currentHighest;
  const isLeadingBidder = modal.myCurrentBid !== null && modal.myCurrentBid === modal.currentHighest;

  function adjustBid(delta: number) {
    const next = Math.max(0, (isNaN(bidNum) ? 0 : bidNum) + delta);
    setBidAmount(String(next));
  }

  // ── Confirm button label ─────────────────────────────────────────────────────

  const confirmLabel = modal.currentExpiry
    ? `Confirm Bid — £${isNaN(bidNum) ? '?' : bidNum}m`
    : `Start Auction — £${isNaN(bidNum) ? '?' : bidNum}m`;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── Page Header ── */}
      <header className={styles.pageHeader}>
        <div className={styles.titleBlock}>
          <h1 className={styles.pageTitle}>Player Market</h1>
          <p className={styles.pageSubtitle}>
            Free agents available for auction · 48-hour bidding window
          </p>
        </div>
        <div className={styles.faabBadge}>
          <span className={styles.faabLabel}>Your FAAB</span>
          <span className={styles.faabAmount}>£{myTeam.faab_budget}m</span>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === 'market' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('market')}
        >
          Player Market
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'auctions' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('auctions')}
        >
          Active Auctions
          {auctions.length > 0 && ` (${auctions.length})`}
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          Player Market Tab
      ══════════════════════════════════════════════ */}
      {activeTab === 'market' && (
        <div className={styles.marketLayout}>

          {/* ── Player List ── */}
          <div>
            {/* Search */}
            <form onSubmit={handleSearch} className={styles.searchRow}>
              <input
                ref={searchInputRef}
                name="q"
                defaultValue=""
                className={styles.searchInput}
                placeholder="Search by name or club…"
                onChange={(e) => setSearchQ(e.target.value)}
              />
              {searchQ && (
                <button
                  type="button"
                  className={styles.searchBtn}
                  onClick={() => {
                    setSearchQ('');
                    if (searchInputRef.current) searchInputRef.current.value = '';
                  }}
                >
                  Clear
                </button>
              )}
            </form>

            {/* Position filters */}
            <div className={styles.posFilters}>
              <button
                type="button"
                className={`${styles.posFilter} ${!searchPos ? styles.posFilterActive : ''}`}
                onClick={() => setSearchPos('')}
              >
                ALL
              </button>
              {positions.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.posFilter} ${searchPos === p ? styles.posFilterActive : ''}`}
                  onClick={() => setSearchPos(searchPos === p ? '' : p)}
                >
                  {p}
                </button>
              ))}
            </div>

            <p className={styles.resultCount}>
              {freeAgents.length} of {allFreeAgents.length} player{allFreeAgents.length !== 1 ? 's' : ''} shown
            </p>

            <div className={styles.playerList}>
              {freeAgents.length === 0 ? (
                <p className={styles.emptyActivity}>No players match your search.</p>
              ) : (
                freeAgents.map((player) => {
                  const inAuction = auctions.some((a) => a.player.id === player.id);
                  return (
                    <div
                      key={player.id}
                      className={`${styles.playerCard} ${inAuction ? styles.playerCardInAuction : ''}`}
                    >
                      <PosBadge position={player.primary_position} />

                      <div className={styles.playerIdentity}>
                        <button
                          type="button"
                          className={styles.playerName}
                          onClick={() => setViewingPlayer(player)}
                        >
                          {formatPlayerName(player, 'initial_last')}
                        </button>
                        <span className={styles.playerClub}>{player.pl_team}</span>
                      </div>

                      <div className={styles.playerStats}>
                        <div className={styles.statCol}>
                          <span className={styles.statLabel}>PPG</span>
                          <span className={styles.statValue}>{formatStat(player.ppg)}</span>
                        </div>
                        <div className={styles.statCol}>
                          <span className={styles.statLabel}>Form</span>
                          <span className={styles.statValue}>{formatStat(player.form_rating)}</span>
                        </div>
                        <div className={styles.statCol}>
                          <span className={styles.statLabel}>Mkt Val</span>
                          <span className={styles.statValue}>{formatMarketValue(player.market_value)}</span>
                        </div>
                      </div>

                      {inAuction ? (
                        <span className={styles.inAuctionBadge}>In Auction</span>
                      ) : (
                        <button
                          className={styles.bidBtn}
                          onClick={() => openBidModal(player, 0, null, null, null, [])}
                        >
                          Bid
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Recent Auctions Sidebar ── */}
          <aside className={styles.recentAuctionsSidebar}>
            <div className={styles.sidebarHeader}>
              <h3 className={styles.sidebarTitle}>Recent Auctions</h3>
              <p className={styles.sidebarSubtitle}>Transfer Window Activity</p>
            </div>

            {initialRecentActivity.length === 0 ? (
              <p className={styles.emptyActivity}>No completed auctions yet.</p>
            ) : (
              <div className={styles.activityList}>
                {initialRecentActivity.map((item) => {
                  const playerName = item.player
                    ? (item.player.web_name || item.player.name)
                    : '—';
                  const teamName = item.team?.team_name ?? '—';
                  const bid = item.faab_bid != null ? `£${item.faab_bid}m` : '—';
                  const when = item.processed_at ? timeAgo(item.processed_at) : '';
                  return (
                    <div key={item.id} className={styles.activityItem}>
                      <div className={styles.activityLeft}>
                        <p className={styles.activityPlayerName}>{playerName}</p>
                        <p className={styles.activityTeam}>{teamName}</p>
                      </div>
                      <div className={styles.activityRight}>
                        <span className={styles.activityBid}>{bid}</span>
                        <span className={styles.activityTime}>{when}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.sidebarFooter}>
              <Link
                href={`/league/${leagueId}/activity`}
                className={styles.viewAllLink}
              >
                View all activity →
              </Link>
            </div>
          </aside>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          Active Auctions Tab
      ══════════════════════════════════════════════ */}
      {activeTab === 'auctions' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <p className={styles.resultCount}>
              {auctions.length === 0
                ? 'No active auctions'
                : `${auctions.length} auction${auctions.length !== 1 ? 's' : ''} in progress`}
            </p>
            <button className={styles.refreshBtn} onClick={refresh} disabled={refreshing}>
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          </div>

          <div className={styles.auctionsGrid}>
            {auctions.length === 0 ? (
              <div className={styles.auctionsEmptyState}>
                <p className={styles.auctionsEmptyTitle}>No active auctions</p>
                <p className={styles.auctionsEmptyHint}>
                  Drop a player from your roster to start a 48-hour bidding window,
                  or make an offer on a free agent in the Player Market tab.
                </p>
              </div>
            ) : (
              auctions.map((auction) => {
                const isUrgent = new Date(auction.expires_at).getTime() - now < ANTI_SNIPE_WINDOW_MS;
                const isLeading = auction.highest_bidder_team_id === myTeam.id;
                const isExpired = new Date(auction.expires_at).getTime() <= now;
                const tmMin = Math.floor(Number(auction.player.market_value || 0) * 0.2);

                return (
                  <div
                    key={auction.player.id}
                    className={`${styles.auctionCard} ${isUrgent ? styles.auctionCardUrgent : ''}`}
                  >
                    <div className={styles.auctionCardTop}>
                      <PosBadge position={auction.player.primary_position} />
                      <div className={styles.auctionPlayerInfo}>
                        <button
                          type="button"
                          className={styles.auctionPlayerName}
                          onClick={() => setViewingPlayer(auction.player)}
                        >
                          {formatPlayerName(auction.player, 'initial_last')}
                        </button>
                        <span className={styles.auctionPlayerClub}>{auction.player.pl_team}</span>
                      </div>
                    </div>

                    <div className={styles.auctionCardStats}>
                      <div className={styles.statCol}>
                        <span className={styles.statLabel}>PPG</span>
                        <span className={styles.statValue}>{formatStat(auction.player.ppg)}</span>
                      </div>
                      <div className={styles.statCol}>
                        <span className={styles.statLabel}>Form</span>
                        <span className={styles.statValue}>{formatStat(auction.player.form_rating)}</span>
                      </div>
                      <div className={styles.statCol}>
                        <span className={styles.statLabel}>Mkt Val</span>
                        <span className={styles.statValue}>{formatMarketValue(auction.player.market_value)}</span>
                      </div>
                    </div>

                    <div className={styles.auctionInfo}>
                      <div className={styles.auctionInfoRow}>
                        <div>
                          <div className={styles.auctionInfoLabel}>Current Bid</div>
                          <div className={styles.auctionInfoBid}>£{auction.highest_bid}m</div>
                          <div className={styles.auctionInfoLeader}>
                            {isLeading ? `You (${myTeam.team_name})` : auction.highest_bidder_team_name}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className={styles.auctionInfoLabel}>Time Remaining</div>
                          <div className={`${styles.auctionInfoCountdown} ${isUrgent ? styles.countdownUrgent : ''}`}>
                            {formatCountdown(auction.expires_at, now)}
                          </div>
                          <div className={styles.auctionInfoLeader}>{formatEndTime(auction.expires_at)}</div>
                        </div>
                      </div>

                      <div className={styles.auctionInfoDivider} />

                      <button
                        className={styles.auctionPlaceBidBtn}
                        disabled={isExpired}
                        onClick={() =>
                          openBidModal(
                            auction.player,
                            auction.highest_bid,
                            auction.expires_at,
                            auction.my_bid,
                            auction.my_drop_player_id,
                            auction.bid_history ?? [],
                          )
                        }
                      >
                        {isExpired ? 'Processing…' : isLeading ? 'Raise Bid' : 'Place Bid'}
                      </button>

                      {tmMin > 0 && (
                        <p className={styles.auctionMinBid}>Min bid: £{tmMin}m</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          Bid Modal
      ══════════════════════════════════════════════ */}
      {modal.open && modal.player && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {modal.currentExpiry ? 'Place a Bid' : 'Start Auction'}
              </h2>
              <button className={styles.modalClose} onClick={closeModal} aria-label="Close">×</button>
            </div>

            <div className={styles.modalBody}>

              {/* Player info */}
              <div className={styles.modalPlayerPanel}>
                <div className={styles.modalPlayerLeft}>
                  <PosBadge position={modal.player.primary_position} />
                  <div className={styles.modalPlayerMeta}>
                    <p className={styles.modalPlayerName}>
                      {formatPlayerName(modal.player, 'initial_last')}
                    </p>
                    <p className={styles.modalPlayerClub}>
                      {modal.player.pl_team} · {modal.player.primary_position}
                    </p>
                  </div>
                </div>
                <div className={styles.modalPlayerStats}>
                  <div className={styles.statCol}>
                    <span className={styles.statLabel}>PPG</span>
                    <span className={styles.statValue}>{formatStat(modal.player.ppg)}</span>
                  </div>
                  <div className={styles.statDivider} />
                  <div className={styles.statCol}>
                    <span className={styles.statLabel}>Mkt Val</span>
                    <span className={styles.statValue}>{formatMarketValue(modal.player.market_value)}</span>
                  </div>
                </div>
              </div>

              {/* Auction status / new auction hint */}
              {modal.currentExpiry ? (
                <div className={styles.auctionStatusPanel}>
                  <div className={styles.auctionStatusTop}>
                    <div className={styles.auctionStatusBidBlock}>
                      <div className={styles.auctionStatusBidLabel}>Current Bid</div>
                      <div className={styles.auctionStatusBidAmount}>£{modal.currentHighest}m</div>
                      <div className={styles.auctionStatusLeader}>
                        {modal.myCurrentBid === modal.currentHighest
                          ? `You (${myTeam.team_name})`
                          : modal.bidHistory?.[0]?.team_name ?? '—'}
                      </div>
                    </div>
                    <div className={styles.auctionStatusTimerBlock}>
                      <div className={styles.auctionStatusTimerLabel}>Time Remaining</div>
                      <div className={`${styles.auctionStatusTimer} ${
                        new Date(modal.currentExpiry).getTime() - now < ANTI_SNIPE_WINDOW_MS
                          ? styles.auctionStatusTimerUrgent
                          : ''
                      }`}>
                        {formatCountdown(modal.currentExpiry, now)}
                      </div>
                    </div>
                  </div>

                  {/* Bid history */}
                  {modal.bidHistory && modal.bidHistory.length > 0 && (
                    <>
                      <div className={styles.bidHistoryDivider} />
                      <div className={styles.bidHistoryList}>
                        {modal.bidHistory.slice(0, 3).map((bid, i) => (
                          <div key={i} className={styles.bidHistoryItem}>
                            <span className={styles.bidHistoryTeam}>
                              <span className={`${styles.bidHistoryDot} ${i === 0 ? styles.bidHistoryDotLeading : styles.bidHistoryDotOther}`} />
                              {bid.team_name}
                            </span>
                            <span className={styles.bidHistoryAmount}>£{bid.faab_bid}m</span>
                            <span className={styles.bidHistoryTime}>{timeAgo(bid.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className={styles.newAuctionHint}>
                  You are the first to bid — this will open a 48-hour public auction window.
                  All managers can see and counter any bid.
                </p>
              )}

              {/* Bid input */}
              <div className={styles.bidInputSection}>
                <span className={styles.bidInputLabel}>Your Bid</span>
                <div className={styles.bidStepper}>
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    onClick={() => adjustBid(-1)}
                    aria-label="Decrease bid"
                  >−</button>
                  <input
                    type="number"
                    min={0}
                    max={myTeam.faab_budget}
                    step={1}
                    className={styles.stepperInput}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.stepperBtn}
                    onClick={() => adjustBid(1)}
                    aria-label="Increase bid"
                  >+</button>
                  <span className={styles.stepperUnit}>£m</span>
                </div>

                <div className={styles.bidContextInfo}>
                  <span>
                    Min bid: <strong>£{Math.max(auctionMin, tmMin)}m</strong>
                    {tmMin > 0 && ` (£${tmMin}m Transfermarkt floor)`}
                  </span>
                  <span className={styles.bidContextInfoGreen}>
                    Balance: <strong>£{myTeam.faab_budget}m</strong>
                  </span>
                </div>

                {/* Contextual lead message */}
                {!isNaN(bidNum) && modal.currentExpiry && (
                  bidNum > modal.currentHighest ? (
                    <p className={styles.bidLeadMessage}>
                      Your bid of £{bidNum}m would put you in the lead.
                    </p>
                  ) : isLeadingBidder ? (
                    <p className={styles.bidLeadMessage}>You are currently the highest bidder.</p>
                  ) : (
                    <p className={styles.bidWarnMessage}>
                      Bid above £{modal.currentHighest}m to take the lead.
                    </p>
                  )
                )}
              </div>

              {/* Drop selector */}
              {rosterFull && (
                <label className={styles.modalLabel}>
                  Drop player (roster full)
                  <select
                    className={styles.modalSelect}
                    value={dropPlayerId}
                    onChange={(e) => setDropPlayerId(e.target.value)}
                  >
                    <option value="">— Select player to release —</option>
                    {myRoster.map((p) => {
                      const fee = Math.floor(Number(p.market_value || 0) * 0.1);
                      return (
                        <option key={p.id} value={p.id}>
                          {formatPlayerName(p as any)} ({p.primary_position} · {p.pl_team})
                          {fee > 0 ? ` — −£${fee}m severance` : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}

              {/* Error */}
              {submitError && <p className={styles.modalError}>{submitError}</p>}
            </div>

            {/* Footer */}
            <div className={styles.modalFooter}>
              <button
                className={styles.submitBtn}
                onClick={handleSubmitBid}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : confirmLabel}
              </button>
              <button className={styles.cancelBtn} onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              <p className={styles.modalDisclaimer}>
                By bidding you agree to pay if you win · Auction closes when the 48-hour window expires
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Player details modal */}
      <PlayerDetailsModal
        player={viewingPlayer}
        onClose={() => setViewingPlayer(null)}
      />
    </div>
  );
}
