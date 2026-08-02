'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeDeal } from '@/lib/transfers/describeDeal';
import styles from './NegotiationCard.module.css';
import { formatNegotiationStatus } from './negotiationStatus';

export interface TradeSummaryAsset {
  id: string;
  name: string;
}

export interface TradeSummary {
  id: string;
  status: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  offeredPlayers: TradeSummaryAsset[];
  requestedPlayers: TradeSummaryAsset[];
  offeredRights: TradeSummaryAsset[];
  requestedRights: TradeSummaryAsset[];
  offeredFaab: number;
  requestedFaab: number;
  saleListingId: string | null;
  parentTradeId: string | null;
  message: string | null;
  createdAt: string;
}

const money = (n: number) => `€${n}m`;

function AssetLines({ players, rights, align }: { players: TradeSummaryAsset[]; rights: TradeSummaryAsset[]; align?: 'right' }) {
  if (players.length === 0 && rights.length === 0) return null;
  return (
    <div className={`${styles.assets} ${align === 'right' ? styles.assetsRight : ''}`}>
      {players.map((p) => (
        <span key={p.id} className={styles.assetName}>{p.name}</span>
      ))}
      {rights.map((r) => (
        <span key={r.id} className={styles.assetName}>
          {r.name} <span className={styles.assetRightsTag}>(rights)</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Live, interactive trade/listing-offer card for the chat DM thread — reads
 * current state off `trade` (fetched fresh alongside the message, see
 * GET /api/chat) rather than a snapshot embedded at proposal time, so it
 * reflects resolution even if the deal was answered elsewhere (Deals page,
 * another tab). A listing purchase offer is a trade_proposals row with
 * `saleListingId` set — same card, distinguished only by tag copy.
 */
export default function TradeOfferCard({
  trade,
  leagueId,
  currentTeamId,
  onActionComplete,
}: {
  trade: TradeSummary;
  leagueId: string;
  currentTeamId: string | null;
  onActionComplete?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iAmProposer = currentTeamId === trade.teamAId;
  const iAmResponder = currentTeamId === trade.teamBId;
  const incoming = iAmResponder;

  const theyGive = incoming ? trade.offeredPlayers : trade.requestedPlayers;
  const youGive = incoming ? trade.requestedPlayers : trade.offeredPlayers;
  const theyGiveRights = incoming ? trade.offeredRights : trade.requestedRights;
  const youGiveRights = incoming ? trade.requestedRights : trade.offeredRights;
  const theirCash = incoming ? trade.offeredFaab : trade.requestedFaab;
  const yourCash = incoming ? trade.requestedFaab : trade.offeredFaab;
  const them = incoming ? trade.teamAName : trade.teamBName;

  const naming = describeDeal({
    offered: [...trade.offeredPlayers.map((p) => p.name), ...trade.offeredRights.map((r) => `${r.name}'s rights`)],
    requested: [...trade.requestedPlayers.map((p) => p.name), ...trade.requestedRights.map((r) => `${r.name}'s rights`)],
    offeredFaab: trade.offeredFaab,
    requestedFaab: trade.requestedFaab,
  });

  const act = async (action: 'accept' | 'reject' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/trades/${trade.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That could not be completed.');
      } else {
        onActionComplete?.();
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const counter = () => {
    window.dispatchEvent(new Event('navigation-start'));
    router.push(`/league/${leagueId}/transfers/deals?counter=trade:${trade.id}`);
  };

  const isPending = trade.status === 'pending';
  const title = trade.parentTradeId
    ? (incoming ? `${them} countered you` : `You countered ${them}`)
    : (incoming ? `${them} → you` : `You → ${them}`);

  return (
    <article className={`${styles.card} ${isPending && incoming ? styles.cardActive : ''}`}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.tag} style={{ background: trade.saleListingId ? 'var(--color-accent)' : 'var(--color-pos-cb)' }}>
          {naming.headline}{trade.saleListingId ? ' · listed player' : ''}
        </span>
      </header>

      <div className={styles.sides}>
        <div className={styles.side}>
          <div className={styles.label}>They give</div>
          <AssetLines players={theyGive} rights={theyGiveRights} />
          {theirCash > 0 && <div className={styles.cash}>{money(theirCash)}</div>}
          {theyGive.length === 0 && theyGiveRights.length === 0 && theirCash === 0 && <div className={styles.none}>—</div>}
        </div>
        <div className={styles.swap} aria-hidden="true">⇄</div>
        <div className={`${styles.side} ${styles.sideRight}`}>
          <div className={styles.label}>You give</div>
          <AssetLines players={youGive} rights={youGiveRights} align="right" />
          {yourCash > 0 && <div className={styles.cash}>{money(yourCash)}</div>}
          {youGive.length === 0 && youGiveRights.length === 0 && yourCash === 0 && <div className={styles.none}>—</div>}
        </div>
      </div>

      {trade.message && <p className={styles.note}>&ldquo;{trade.message}&rdquo;</p>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        {isPending && incoming ? (
          <>
            <button type="button" className={`${styles.btn} ${styles.btnYes}`} disabled={busy} onClick={() => act('accept')}>Accept</button>
            <button type="button" className={styles.btn} disabled={busy} onClick={counter}>Counter</button>
            <button type="button" className={styles.btn} disabled={busy} onClick={() => act('reject')}>Decline</button>
          </>
        ) : isPending && iAmProposer ? (
          <button type="button" className={styles.btn} disabled={busy} onClick={() => act('cancel')}>Withdraw</button>
        ) : (
          <span className={styles.status}>{formatNegotiationStatus(trade.status)}</span>
        )}
      </div>
    </article>
  );
}
