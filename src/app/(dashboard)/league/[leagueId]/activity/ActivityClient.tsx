'use client';

import { useState, useMemo } from 'react';
import { formatPlayerName } from '@/lib/formatName';
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
  DM: 'var(--color-pos-dm)',
  CM: 'var(--color-pos-cm)',
  LM: 'var(--color-pos-cm)',
  RM: 'var(--color-pos-cm)',
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
    borderColor: '#a855f7',
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
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'JUST NOW';
  if (diffMins < 60) return `${diffMins} MIN AGO`;
  if (diffHours < 24) return `${diffHours} HR${diffHours > 1 ? 'S' : ''} AGO`;
  if (diffDays === 1)
    return `YESTERDAY, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return (
    date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ', ' +
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
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

function PositionBadge({ position }: { position: string }) {
  const color = POS_COLOR_MAP[position] ?? 'var(--color-text-muted)';
  return (
    <span className={styles.posBadge} style={{ backgroundColor: color }}>
      {position}
    </span>
  );
}

function PlayerPhoto({ player }: { player: Player | null }) {
  if (!player) return <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}><IconQuestion /></div>;
  if (player.photo_url) {
    return (
      <img
        src={player.photo_url}
        alt={player.web_name ?? player.name}
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
    default:
      return (
        <div className={`${styles.iconSlot} ${styles.iconSlotGray}`}>
          <IconQuestion />
        </div>
      );
  }
}

// ─── Card Content ─────────────────────────────────────────────────────────────

function CardContent({ tx }: { tx: Transaction }) {
  const team = tx.team;
  const player = tx.player;
  const teamName = team?.team_name ?? 'Unknown';
  const playerName = player ? formatPlayerName(player) : null;

  switch (tx.type) {
    case 'waiver_claim':
    case 'free_agent_pickup': {
      return (
        <>
          <p className={styles.cardMain}>
            <strong className={styles.cardTeam}>{teamName}</strong>
            <span className={styles.cardVerb}> signed </span>
            <strong className={styles.cardPlayer}>{playerName ?? '—'}</strong>
            {player && <PositionBadge position={player.primary_position} />}
            {player?.pl_team && (
              <span className={styles.cardClub}>· {player.pl_team}</span>
            )}
          </p>
          {tx.faab_bid != null && (
            <p className={styles.cardMeta}>£{tx.faab_bid}m bid</p>
          )}
        </>
      );
    }

    case 'drop': {
      const dropCost =
        tx.compensation_amount && Number(tx.compensation_amount) > 0
          ? `£${Number(tx.compensation_amount).toFixed(1)}m severance`
          : null;
      return (
        <>
          <p className={styles.cardMain}>
            <strong className={styles.cardTeam}>{teamName}</strong>
            <span className={styles.cardVerb}> released </span>
            <span className={`${styles.cardPlayer} ${styles.strikethrough}`}>
              {playerName ?? '—'}
            </span>
            {player && <PositionBadge position={player.primary_position} />}
            {player?.pl_team && (
              <span className={styles.cardClub}>· {player.pl_team}</span>
            )}
          </p>
          {dropCost && (
            <p className={`${styles.cardMeta} ${styles.metaRed}`}>
              Drop cost: {dropCost}
            </p>
          )}
        </>
      );
    }

    case 'transfer_out': {
      const amount =
        tx.compensation_amount && Number(tx.compensation_amount) > 0
          ? `£${Number(tx.compensation_amount).toFixed(1)}m`
          : null;
      return (
        <>
          <p className={styles.cardMain}>
            <strong className={styles.cardPlayer}>{playerName ?? '—'}</strong>
            {player && <PositionBadge position={player.primary_position} />}
            <span className={styles.cardVerb}>
              {' '}transferred out of the Premier League
            </span>
          </p>
          {amount && (
            <p className={styles.cardMeta}>
              {teamName} received {amount} compensation
            </p>
          )}
        </>
      );
    }

    case 'trade': {
      return (
        <p className={styles.cardMain}>
          <strong className={styles.cardTeam}>{teamName}</strong>
          {tx.notes && (
            <span className={styles.cardNotes}> — {tx.notes}</span>
          )}
        </p>
      );
    }

    case 'rebate': {
      const amount =
        tx.compensation_amount && Number(tx.compensation_amount) > 0
          ? `£${Number(tx.compensation_amount).toFixed(1)}m`
          : tx.faab_bid != null
          ? `£${tx.faab_bid}m`
          : null;
      return (
        <p className={styles.cardMain}>
          <strong className={styles.cardTeam}>{teamName}</strong>
          <span className={styles.cardVerb}> received Scout's Rebate</span>
          {amount && <span className={styles.cardMeta}> · {amount}</span>}
        </p>
      );
    }

    case 'transfer_compensation': {
      const amount =
        tx.compensation_amount && Number(tx.compensation_amount) > 0
          ? `£${Number(tx.compensation_amount).toFixed(1)}m`
          : null;
      return (
        <>
          <p className={styles.cardMain}>
            <strong className={styles.cardTeam}>{teamName}</strong>
            <span className={styles.cardVerb}> received transfer compensation</span>
            {player && (
              <>
                <span className={styles.cardVerb}> for </span>
                <strong className={styles.cardPlayer}>{playerName}</strong>
                <PositionBadge position={player.primary_position} />
              </>
            )}
          </p>
          {amount && (
            <p className={styles.cardMeta}>{amount} budget returned</p>
          )}
        </>
      );
    }

    case 'draft_pick': {
      return (
        <p className={styles.cardMain}>
          <strong className={styles.cardTeam}>{teamName}</strong>
          <span className={styles.cardVerb}> drafted </span>
          <strong className={styles.cardPlayer}>{playerName ?? '—'}</strong>
          {player && <PositionBadge position={player.primary_position} />}
          {player?.pl_team && (
            <span className={styles.cardClub}>· {player.pl_team}</span>
          )}
        </p>
      );
    }

    default: {
      return (
        <p className={styles.cardMain}>
          <strong className={styles.cardTeam}>{teamName}</strong>
          {tx.notes && (
            <span className={styles.cardNotes}> — {tx.notes}</span>
          )}
        </p>
      );
    }
  }
}

// ─── Transaction Card ─────────────────────────────────────────────────────────

function TransactionCard({ tx }: { tx: Transaction }) {
  const cfg: TypeCfg = TYPE_CONFIG[tx.type] ?? {
    label: tx.type.toUpperCase().replace(/_/g, ' '),
    borderColor: 'var(--color-text-muted)',
    badgeVariant: 'gray',
  };

  return (
    <article
      className={styles.card}
      style={{ borderLeftColor: cfg.borderColor }}
    >
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
        <CardContent tx={tx} />
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
    const pid = claim.player.id;
    const existing = map.get(pid);

    if (!existing) {
      map.set(pid, {
        player: claim.player,
        topBid: claim.faab_bid,
        expiresAt: claim.expires_at,
        bidCount: 1,
        myBid: claim.team_id === myTeamId ? claim.faab_bid : null,
      });
    } else {
      existing.bidCount++;
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

// ─── Live Bids Section (main feed) ───────────────────────────────────────────

function LiveBidsSection({
  liveAuctions,
  myTeamId,
}: {
  liveAuctions: WaiverClaim[];
  myTeamId: string | null;
}) {
  const auctions = useMemo(
    () => groupAuctions(liveAuctions, myTeamId),
    [liveAuctions, myTeamId],
  );

  if (auctions.length === 0) return null;

  return (
    <section className={styles.dateGroup}>
      <div className={styles.dateLabelRow}>
        <span className={styles.dateLabel}>LIVE AUCTIONS</span>
        <div className={styles.dateRule} />
      </div>
      <div className={styles.cards}>
        {auctions.map((a) => {
          const posColor = POS_COLOR_MAP[a.player.primary_position] ?? 'var(--color-text-muted)';
          return (
            <article
              key={a.player.id}
              className={styles.card}
              style={{ borderLeftColor: '#d97706' }}
            >
              <div className={styles.cardIconWrap}>
                {a.player.photo_url ? (
                  <img
                    src={a.player.photo_url}
                    alt={a.player.web_name ?? a.player.name}
                    className={styles.playerPhoto}
                  />
                ) : (
                  <div className={styles.posAvatar} style={{ backgroundColor: posColor }}>
                    {a.player.primary_position}
                  </div>
                )}
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardHeader}>
                  <span className={`${styles.typeBadge} ${styles.badge_amber}`}>
                    LIVE BID
                  </span>
                  <span className={styles.timestamp}>
                    {getTimeRemaining(a.expiresAt)}
                  </span>
                </div>
                <p className={styles.cardMain}>
                  <strong className={styles.cardPlayer}>
                    {a.player.web_name ?? formatPlayerName(a.player)}
                  </strong>
                  <PositionBadge position={a.player.primary_position} />
                  {a.player.pl_team && (
                    <span className={styles.cardClub}>· {a.player.pl_team}</span>
                  )}
                </p>
                <p className={styles.cardMeta}>
                  {a.bidCount} bid{a.bidCount !== 1 ? 's' : ''} · Top: £{a.topBid}m
                  {a.myBid !== null && (
                    <span style={{ color: 'var(--color-accent-green)', fontWeight: 700 }}>
                      {' '}· Your bid: £{a.myBid}m
                    </span>
                  )}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RightSidebar({
  liveAuctions,
  teams,
  myTeamId,
}: {
  liveAuctions: WaiverClaim[];
  teams: Team[];
  myTeamId: string | null;
}) {
  const auctions = useMemo(
    () => groupAuctions(liveAuctions, myTeamId),
    [liveAuctions, myTeamId],
  );

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
          <div className={styles.auctionList}>
            {auctions.map((a) => {
              const posColor =
                POS_COLOR_MAP[a.player.primary_position] ??
                'var(--color-text-muted)';
              return (
                <div key={a.player.id} className={styles.auctionItem}>
                  <div className={styles.auctionIcon}>
                    {a.player.photo_url ? (
                      <img
                        src={a.player.photo_url}
                        alt={a.player.web_name ?? a.player.name}
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
                      <span className={styles.auctionPlayerName}>
                        {a.player.web_name ?? formatPlayerName(a.player)}
                      </span>
                      <span
                        className={styles.auctionPosBadge}
                        style={{ backgroundColor: posColor }}
                      >
                        {a.player.primary_position}
                      </span>
                    </div>
                    <div className={styles.auctionMeta}>
                      <span className={styles.auctionBid}>
                        Top bid: £{a.topBid}m
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
                        £{t.faab_budget}m
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
  leagueName,
  myTeamId,
  transactions,
  teams,
  liveAuctions,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const grouped = useMemo(() => {
    const filtered =
      filter === 'all'
        ? transactions
        : transactions.filter((tx) => FILTER_MAP[filter].includes(tx.type));

    const groups: { label: string; items: Transaction[] }[] = [];
    const seen = new Map<string, number>();

    for (const tx of filtered) {
      const label = getDateLabel(tx.processed_at);
      const idx = seen.get(label);
      if (idx === undefined) {
        groups.push({ label, items: [tx] });
        seen.set(label, groups.length - 1);
      } else {
        groups[idx].items.push(tx);
      }
    }

    return groups;
  }, [transactions, filter]);

  return (
    <div className={styles.layout}>
      {/* Main Feed */}
      <main className={styles.feed}>
        {/* Header */}
        <header className={styles.header}>
          <p className={styles.eyebrow}>TRANSACTION HISTORY</p>
          <h1 className={styles.title}>The Transfer Gazette</h1>
          <p className={styles.subtitle}>
            Every move, every deal — the full record of {leagueName}.
          </p>
        </header>

        {/* Live Auctions — pending bids visible to all managers */}
        <LiveBidsSection liveAuctions={liveAuctions} myTeamId={myTeamId} />

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
                  {group.items.map((tx) => (
                    <TransactionCard key={tx.id} tx={tx} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Right Sidebar */}
      <RightSidebar
        liveAuctions={liveAuctions}
        teams={teams}
        myTeamId={myTeamId}
      />
    </div>
  );
}
