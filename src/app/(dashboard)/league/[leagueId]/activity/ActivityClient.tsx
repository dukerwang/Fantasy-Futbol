'use client';

import { useState, useMemo } from 'react';

import { getPlayerDisplayName } from '@/lib/players/displayName';
import { generateTransactionHeadline } from '@/lib/narrative/generators';
import { renderBoldedText } from '@/lib/narrative/boldText';
import { createClient } from '@/lib/supabase/client';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import PositionBadge from '@/components/players/PositionBadge';
import { Icon } from '@/components/ui/Icon';
import type { GranularPosition, Player as FullPlayer } from '@/types';
import styles from './activity.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  web_name: string | null;
  name: string;
  primary_position: string;
  photo_url: string | null;
  pl_team: string | null;
}

interface Team {
  id: string;
  team_name: string;
  faab_budget: number;
  user?: { username: string } | null;
}

interface Transaction {
  id: string;
  type: string;
  faab_bid: number | null;
  compensation_amount: string | null;
  notes: string | null;
  processed_at: string;
  team: Team | null;
  player: Player | null;
}

interface WaiverClaim {
  id: string;
  team_id: string | null;
  faab_bid: number;
  created_at: string;
  expires_at: string;
  sale_listing_id?: string | null;
  first_bid_at?: string | null;
  player: Player | null;
  team: Team | null;
}

interface Props {
  leagueId: string;
  leagueName: string;
  myTeamId: string | null;
  transactions: Transaction[];
  teams: Team[];
  liveAuctions: WaiverClaim[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POS_COLOR_MAP: Record<string, string> = {
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

type FilterKey = 'all' | 'signings' | 'drops' | 'trades' | 'waivers' | 'bids';

const FILTER_MAP: Record<FilterKey, string[]> = {
  all: [],
  signings: ['waiver_claim', 'free_agent_pickup', 'draft_pick'],
  drops: ['drop', 'transfer_out'],
  trades: ['trade'],
  waivers: ['waiver_claim'],
  bids: ['rebate', 'transfer_compensation'],
};

const FILTER_LABELS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ALL ACTIVITY' },
  { key: 'signings', label: 'SIGNINGS' },
  { key: 'drops', label: 'DROPS' },
  { key: 'trades', label: 'TRADES' },
  { key: 'waivers', label: 'WAIVERS' },
  { key: 'bids', label: 'BIDS' },
];

interface TypeCfg {
  label: string;
  borderColor: string;
  badgeVariant: 'green' | 'red' | 'amber' | 'purple' | 'blue' | 'gray';
}

const TYPE_CONFIG: Record<string, TypeCfg> = {
  waiver_claim: {
    label: 'AUCTION WIN',
    borderColor: 'var(--color-accent-green)',
    badgeVariant: 'green',
  },
  free_agent_pickup: {
    label: 'FREE SIGNING',
    borderColor: 'var(--color-accent-green)',
    badgeVariant: 'green',
  },
  drop: { label: 'RELEASED', borderColor: '#ef4444', badgeVariant: 'red' },
  transfer_out: {
    label: 'TRANSFERRED OUT',
    borderColor: '#ef4444',
    badgeVariant: 'red',
  },
  trade: { label: 'TRADE', borderColor: '#f59e0b', badgeVariant: 'amber' },
  transfer_compensation: {
    label: 'COMPENSATION',
    borderColor: 'var(--color-accent-green)',
    badgeVariant: 'purple',
  },
  rebate: {
    label: "SCOUT'S REBATE",
    borderColor: '#f59e0b',
    badgeVariant: 'amber',
  },
  draft_pick: {
    label: 'DRAFT PICK',
    borderColor: 'var(--color-text-muted)',
    badgeVariant: 'gray',
  },
  prize_payout: {
    label: 'PRIZE PAYOUT',
    borderColor: '#d97706',
    badgeVariant: 'amber',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateLabel(processed_at: string): string {
  const date = new Date(processed_at);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const txDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  if (txDate.getTime() === today.getTime()) return 'TODAY';
  if (txDate.getTime() === yesterday.getTime()) return 'YESTERDAY';
  return date
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    .toUpperCase();
}

function getRelativeTime(processed_at: string): string {
  const date = new Date(processed_at);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'JUST NOW';
  if (diffMins < 60) return `${diffMins} MIN AGO`;
  if (diffHours < 24) return `${diffHours} HR${diffHours > 1 ? 'S' : ''} AGO`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (txDate.getTime() === yesterday.getTime()) {
    return `YESTERDAY, ${timeStr}`;
  }
  return timeStr;
}

function getTimeRemaining(expiresAt: string): string {
  const end = new Date(expiresAt);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return 'CLOSING';
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${diffHours}h ${diffMins}m left`;
}

// ─── Small Sub-Components ─────────────────────────────────────────────────────

function PlayerPhoto({ player }: { player: Player | null }) {
  if (!player) return <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}><IconQuestion /></div>;
  if (player.photo_url) {
    return (
      <img
        src={player.photo_url}
        alt={getPlayerDisplayName(player, 'full')}
        className={styles.playerPhoto}
      />
    );
  }
  const color = POS_COLOR_MAP[player.primary_position] ?? 'var(--color-text-muted)';
  return (
    <div className={styles.posAvatar} style={{ backgroundColor: color }}>
      {player.primary_position}
    </div>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconDrop() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="8" x2="22" y2="13" />
      <line x1="22" y1="8" x2="17" y2="13" />
    </svg>
  );
}

function IconTrade() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 16V4m0 0L3 8m4-4 4 4" />
      <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
    </svg>
  );
}

function IconMoney() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconDraft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconTransferOut() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8L22 12L18 16" />
      <path d="M2 12H22" />
      <path d="M2 6h8" />
      <path d="M2 18h8" />
    </svg>
  );
}

function IconQuestion() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconGavel() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4.5L9 10" />
      <path d="M9.5 4L4 9.5" />
      <path d="M19 10l-9 9" />
      <path d="M3 21l9-9" />
      <path d="M12.5 4.5l7 7" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <circle cx="16" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function TypeIcon({ type, player }: { type: string; player: Player | null }) {
  switch (type) {
    case 'waiver_claim':
    case 'free_agent_pickup':
      return <PlayerPhoto player={player} />;
    case 'drop':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotRed}`}>
          <IconDrop />
        </div>
      );
    case 'transfer_out':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotRed}`}>
          <IconTransferOut />
        </div>
      );
    case 'trade':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotAmber}`}>
          <IconTrade />
        </div>
      );
    case 'transfer_compensation':
    case 'rebate':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotPurple}`}>
          <IconMoney />
        </div>
      );
    case 'draft_pick':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}>
          <IconDraft />
        </div>
      );
    case 'prize_payout':
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotAmber}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trophy" size={20} />
        </div>
      );
    default:
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}>
          <IconQuestion />
        </div>
      );
  }
}

// ─── Card Content Metadata Helper ─────────────────────────────────────────────

function getTransactionMetadata(tx: Transaction) {
  const parts: string[] = [];
  const player = tx.player;

  if (player) {
    if (player.primary_position) parts.push(player.primary_position);
    if (player.pl_team) parts.push(player.pl_team);
  }

  switch (tx.type) {
    case 'waiver_claim':
      if (tx.faab_bid != null) {
        parts.push(`€${tx.faab_bid}m bid`);
      }
      break;
    case 'free_agent_pickup':
      parts.push('Free transfer');
      break;
    case 'drop': {
      const dropCost = tx.compensation_amount && Number(tx.compensation_amount) > 0
        ? `€${Number(tx.compensation_amount).toFixed(1)}m severance`
        : 'No severance';
      parts.push(dropCost);
      break;
    }
    case 'transfer_out':
    case 'transfer_compensation': {
      const comp = tx.compensation_amount ? Number(tx.compensation_amount) : 0;
      if (comp > 0) {
        parts.push(`€${comp.toFixed(1)}m compensation`);
      }
      break;
    }
    case 'rebate': {
      const comp = tx.compensation_amount ? Number(tx.compensation_amount) : 0;
      const amt = comp > 0 ? comp : tx.faab_bid ?? 0;
      if (amt > 0) {
        parts.push(`€${amt.toFixed(1)}m rebate`);
      }
      break;
    }
    case 'prize_payout':
      if (tx.faab_bid != null && tx.faab_bid > 0) {
        parts.push(`+€${tx.faab_bid}m club balance`);
      }
      if (tx.notes) {
        parts.push(tx.notes);
      }
      break;
    case 'trade':
      parts.push('Roster swap');
      if (tx.notes) {
        parts.push(tx.notes);
      }
      break;
    case 'draft_pick':
      parts.push('Draft Pick');
      break;
    default:
      if (tx.notes) {
        parts.push(tx.notes);
      }
      break;
  }

  return parts.join(' · ');
}

// ─── Transaction Card ─────────────────────────────────────────────────────────

function TransactionCard({
  tx,
  onPlayerClick,
  onPlayerPrefetch,
}: {
  tx: Transaction;
  onPlayerClick?: (playerId: string) => void;
  onPlayerPrefetch?: (playerId: string) => void;
}) {
  const cfg: TypeCfg = TYPE_CONFIG[tx.type] ?? {
    label: tx.type.toUpperCase().replace(/_/g, ' '),
    borderColor: 'var(--color-text-muted)',
    badgeVariant: 'gray',
  };

  const headline = generateTransactionHeadline(tx as any);

  return (
    <article className={styles.card}>
      <div className={styles.cardIconWrap}>
        <TypeIcon type={tx.type} player={tx.player} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <span
            className={`${styles.typeBadge} ${styles[`badge_${cfg.badgeVariant}`]}`}
          >
            {cfg.label}
          </span>
          <span className={styles.timestamp}>
            {getRelativeTime(tx.processed_at)}
          </span>
        </div>
        
        {/* Dynamic Sports Headline */}
        <h3 className={styles.narrativeHeadline}>{renderBoldedText(headline, onPlayerClick, onPlayerPrefetch)}</h3>

        {/* Unified Metadata Sub-row */}
        <span className={styles.metadataSubRow}>{getTransactionMetadata(tx)}</span>
      </div>
    </article>
  );
}

// ─── Right Sidebar ────────────────────────────────────────────────────────────

interface AuctionGroup {
  player: Player;
  topBid: number;
  expiresAt: string;
  bidCount: number;
  myBid: number | null;
}

function groupAuctions(liveAuctions: WaiverClaim[], myTeamId: string | null): AuctionGroup[] {
  const map = new Map<string, AuctionGroup>();

  for (const claim of liveAuctions) {
    if (!claim.player) continue;
    // An untouched manager listing anchor has no bids yet — filter it out
    // so it only displays as a live auction once someone places an opening bid.
    if (claim.sale_listing_id && claim.team_id === null && !claim.first_bid_at) {
      continue;
    }
    const pid = claim.player.id;
    const existing = map.get(pid);
    const isRealBid = claim.team_id !== null;

    if (!existing) {
      map.set(pid, {
        player: claim.player,
        topBid: claim.faab_bid,
        expiresAt: claim.expires_at,
        bidCount: isRealBid ? 1 : 0,
        myBid: claim.team_id === myTeamId ? claim.faab_bid : null,
      });
    } else {
      if (isRealBid) {
        existing.bidCount++;
      }
      existing.topBid = Math.max(existing.topBid, claim.faab_bid);
      // Keep the earliest expiry in case of any discrepancy
      if (new Date(claim.expires_at) < new Date(existing.expiresAt)) {
        existing.expiresAt = claim.expires_at;
      }
      if (claim.team_id === myTeamId) {
        existing.myBid = claim.faab_bid;
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
  );
}

// ─── Bid Card (inline in feed) ───────────────────────────────────────────────

function BidCard({ claim, myTeamId }: { claim: WaiverClaim; myTeamId: string | null }) {
  const { openPlayerById, prefetchPlayer } = usePlayerCard();
  const player = claim.player;
  const isMe = claim.team_id === myTeamId;
  const playerName = player ? getPlayerDisplayName(player, 'full') : '—';
  const posColor = player ? (POS_COLOR_MAP[player.primary_position] ?? 'var(--color-text-muted)') : undefined;

  return (
    <article className={styles.card}>
      <div className={styles.cardIconWrap}>
        {player?.photo_url ? (
          <img src={player.photo_url} alt={playerName} className={styles.playerPhoto} />
        ) : player ? (
          <div className={styles.posAvatar} style={{ backgroundColor: posColor }}>
            {player.primary_position}
          </div>
        ) : (
          <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}><IconQuestion /></div>
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <span className={`${styles.typeBadge} ${isMe ? styles.badge_amber : styles.badge_gray}`}>
            {isMe ? 'YOUR BID' : 'BID PLACED'}
          </span>
          <span className={styles.timestamp}>{getRelativeTime(claim.created_at)}</span>
        </div>
        <h3 className={styles.narrativeHeadline}>
          <strong className={styles.cardTeam}>{claim.team?.team_name ?? 'Unknown'}</strong>
          <span className={styles.cardVerb}> placed a </span>
          <strong className={styles.cardPlayer}>€{claim.faab_bid}m</strong>
          <span className={styles.cardVerb}> bid on </span>
          {player ? (
            <button
              type="button"
              className="playercard-clickable-btn"
              onClick={() => openPlayerById(player.id)}
              {...playerHoverProps(prefetchPlayer, player)}
            >
              {playerName}
            </button>
          ) : (
            <strong className={styles.cardPlayer}>{playerName}</strong>
          )}
        </h3>
        
        {/* Unified Metadata Sub-row */}
        <span className={styles.metadataSubRow}>
          {[
            player?.primary_position,
            player?.pl_team,
            getTimeRemaining(claim.expires_at),
            'Pending'
          ].filter(Boolean).join(' · ')}
        </span>
      </div>
    </article>
  );
}

const AUCTION_PREVIEW_LIMIT = 4;

function RightSidebar({
  leagueId,
  liveAuctions,
  teams,
  myTeamId,
}: {
  leagueId: string;
  liveAuctions: WaiverClaim[];
  teams: Team[];
  myTeamId: string | null;
}) {
  const { openPlayerById, prefetchPlayer } = usePlayerCard();
  const auctions = useMemo(
    () => groupAuctions(liveAuctions, myTeamId),
    [liveAuctions, myTeamId],
  );
  const visibleAuctions = auctions.slice(0, AUCTION_PREVIEW_LIMIT);
  const overflow = auctions.length - AUCTION_PREVIEW_LIMIT;

  return (
    <aside className={styles.sidebar}>
      {/* Live Auctions */}
      <div className={styles.widget}>
        <div className={styles.widgetHeader}>
          <span className={styles.widgetTitle}>LIVE AUCTIONS</span>
          <span className={styles.widgetIcon}>
            <IconGavel />
          </span>
        </div>
        {auctions.length === 0 ? (
          <p className={styles.widgetEmpty}>No active auctions right now.</p>
        ) : (
          <>
            <div className={styles.auctionList}>
              {visibleAuctions.map((a) => {
                const posColor =
                  POS_COLOR_MAP[a.player.primary_position] ??
                  'var(--color-text-muted)';
                return (
                  <div key={a.player.id} className={styles.auctionItem}>
                    <div className={styles.auctionIcon}>
                      {a.player.photo_url ? (
                        <img
                          src={a.player.photo_url}
                          alt={getPlayerDisplayName(a.player, 'full')}
                          className={styles.auctionPhoto}
                        />
                      ) : (
                        <div
                          className={styles.auctionPosAvatar}
                          style={{ backgroundColor: posColor }}
                        >
                          {a.player.primary_position}
                        </div>
                      )}
                    </div>
                    <div className={styles.auctionBody}>
                      <div className={styles.auctionPlayerRow}>
                        <PositionBadge
                          position={a.player.primary_position as GranularPosition}
                          size="sm"
                        />
                        <button
                          type="button"
                          className={styles.auctionPlayerName}
                          onClick={() => openPlayerById(a.player.id)}
                          {...playerHoverProps(prefetchPlayer, a.player)}
                        >
                          {getPlayerDisplayName(a.player, 'initial_last')}
                        </button>
                      </div>
                      <div className={styles.auctionMeta}>
                        <span className={styles.auctionBid}>
                          Top bid: €{a.topBid}m
                        </span>
                        <span className={styles.auctionTimer}>
                          {getTimeRemaining(a.expiresAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {overflow > 0 && (
              <div className={styles.widgetFooter}>
                <a
                  href={`/league/${leagueId}/transfers/auctions`}
                  className={styles.widgetFooterLink}
                >
                  +{overflow} more auction{overflow !== 1 ? 's' : ''} →
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {/* Transfer Budget */}
      <div className={styles.widget}>
        <div className={styles.widgetHeader}>
          <span className={styles.widgetTitle}>TRANSFER BUDGET</span>
          <span className={styles.widgetIcon}>
            <IconWallet />
          </span>
        </div>
        {teams.length === 0 ? (
          <p className={styles.widgetEmpty}>No teams found.</p>
        ) : (
          <>
            <table className={styles.faabTable}>
              <thead>
                <tr>
                  <th className={styles.faabTh}>Manager</th>
                  <th className={`${styles.faabTh} ${styles.faabThRight}`}>
                    Budget
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const isMe = t.id === myTeamId;
                  const username =
                    (t.user as { username: string } | null)?.username ??
                    t.team_name;
                  return (
                    <tr
                      key={t.id}
                      className={`${styles.faabRow} ${isMe ? styles.faabRowMe : ''}`}
                    >
                      <td className={styles.faabTd}>{username}</td>
                      <td className={`${styles.faabTd} ${styles.faabTdRight}`}>
                        €{t.faab_budget}m
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </aside>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ActivityClient({
  leagueId,
  leagueName,
  myTeamId,
  transactions,
  teams,
  liveAuctions,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const { openPlayerById, prefetchPlayer } = usePlayerCard();
  const handlePlayerPrefetch = (id: string) => prefetchPlayer({ id });

  type FeedItem =
    | { kind: 'tx'; ts: string; data: Transaction }
    | { kind: 'bid'; ts: string; data: WaiverClaim };

  const grouped = useMemo(() => {
    const items: FeedItem[] = [];

    // A single auction/drop can fan out one solidarity_payment row per recipient club, all
    // with identical notes/timing — collapse those into one card so the feed isn't spammed.
    const seenSolidarityNotes = new Set<string | null>();
    const dedupedTransactions = transactions.filter((tx) => {
      if (tx.type !== 'solidarity_payment') return true;
      if (seenSolidarityNotes.has(tx.notes)) return false;
      seenSolidarityNotes.add(tx.notes);
      return true;
    });

    // Completed transactions — respect the active filter
    const filteredTx =
      filter === 'all'
        ? dedupedTransactions
        : dedupedTransactions.filter((tx) => FILTER_MAP[filter].includes(tx.type));
    for (const tx of filteredTx) {
      items.push({ kind: 'tx', ts: tx.processed_at, data: tx });
    }

    // Pending bids — shown in "all" and "bids" views
    if (filter === 'all' || filter === 'bids') {
      for (const claim of liveAuctions) {
        if (!claim.player || claim.team_id === null) continue;
        items.push({ kind: 'bid', ts: claim.created_at, data: claim });
      }
    }

    // Sort newest first
    items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    // Group by date label
    const groups: { label: string; items: FeedItem[] }[] = [];
    const seen = new Map<string, number>();
    for (const item of items) {
      const label = getDateLabel(item.ts);
      const idx = seen.get(label);
      if (idx === undefined) {
        groups.push({ label, items: [item] });
        seen.set(label, groups.length - 1);
      } else {
        groups[idx].items.push(item);
      }
    }

    return groups;
  }, [transactions, liveAuctions, filter]);

  return (
    <div className={styles.layout}>
      {/* Main Feed */}
      <main className={styles.feed}>
        {/* Header */}
        <header className={styles.header}>
          <h1 className={styles.title}>The Transfer Gazette</h1>
          <p className={styles.subtitle}>
            Every move, every deal — the full record of {leagueName}.
          </p>
        </header>

        {/* Filter Chips */}
        <div className={styles.filterChips} role="group" aria-label="Filter transactions">
          {FILTER_LABELS.map(({ key, label }) => (
            <button
              key={key}
              className={`${styles.chip} ${filter === key ? styles.chipActive : ''}`}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Feed */}
        {grouped.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No transactions match this filter.</p>
          </div>
        ) : (
          <div className={styles.feedContent}>
            {grouped.map((group) => (
              <section key={group.label} className={styles.dateGroup}>
                <div className={styles.dateLabelRow}>
                  <span className={styles.dateLabel}>{group.label}</span>
                  <div className={styles.dateRule} />
                </div>
                <div className={styles.cards}>
                  {group.items.map((item) =>
                    item.kind === 'tx' ? (
                      <TransactionCard
                        key={item.data.id}
                        tx={item.data}
                        onPlayerClick={openPlayerById}
                        onPlayerPrefetch={handlePlayerPrefetch}
                      />
                    ) : (
                      <BidCard key={item.data.id} claim={item.data} myTeamId={myTeamId} />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Right Sidebar */}
      <RightSidebar
        leagueId={leagueId}
        liveAuctions={liveAuctions}
        teams={teams}
        myTeamId={myTeamId}
      />

      {/* The player card modal is owned by PlayerCardProvider in the dashboard layout. */}
    </div>
  );
}
