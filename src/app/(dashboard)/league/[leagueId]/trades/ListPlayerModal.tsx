'use client';

import { useState } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import styles from './trades.module.css';

export interface ListablePlayer {
  id: string;
  name: string;
  web_name: string | null;
  pl_team?: string | null;
  market_value?: number | null;
  primary_position: string;
  listing?: {
    id: string;
    status: 'pending' | 'active';
    min_bid: number;
    buy_now_price: number | null;
  } | null;
}

interface Props {
  leagueId: string;
  myTeamId: string;
  myRoster: ListablePlayer[];
  onClose: () => void;
  onListed: (playerId: string, listing: any) => void;
  onCancelled: (playerId: string) => void;
}

export default function ListPlayerModal({
  leagueId,
  myTeamId,
  myRoster,
  onClose,
  onListed,
  onCancelled,
}: Props) {
  const [selectedPlayer, setSelectedPlayer] = useState<ListablePlayer | null>(null);
  const [minBid, setMinBid] = useState<number>(0);
  const [buyNowPrice, setBuyNowPrice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter out any active listings from listable selection since they are locked
  const eligiblePlayers = myRoster.filter((p) => p.listing?.status !== 'active');

  async function handleCreateListing(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlayer) return;

    setError(null);
    setSubmitting(true);

    const buyNowNum = buyNowPrice ? parseInt(buyNowPrice, 10) : undefined;

    if (buyNowNum !== undefined && (isNaN(buyNowNum) || buyNowNum <= minBid)) {
      setError('Buy Now price must be higher than the minimum bid.');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/leagues/${leagueId}/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: selectedPlayer.id,
          minBid,
          buyNowPrice: buyNowNum,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        onListed(selectedPlayer.id, data.listing);
        onClose();
      } else {
        setError(data.error ?? 'Failed to list player.');
      }
    } catch (err) {
      console.error(err);
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelListing(player: ListablePlayer, event: React.MouseEvent) {
    event.stopPropagation(); // Prevent row selection click
    if (!player.listing) return;

    setError(null);
    setCancellingId(player.id);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/listings/${player.listing.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        onCancelled(player.id);
      } else {
        const data = await res.json();
        setError(data.error ?? 'Failed to cancel listing.');
      }
    } catch (err) {
      console.error(err);
      setError('An unexpected error occurred.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalLabel}>PLAYER MARKET</span>
            <h2 className={styles.modalTitle}>
              {selectedPlayer ? 'List Player' : 'Your Roster'}
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
              Select a player to list on the market, or manage your current listings.
            </p>

            {eligiblePlayers.length === 0 ? (
              <p className={styles.modalEmpty}>Your roster is empty or all players have live auctions.</p>
            ) : (
              <div className={styles.blockToggleList}>
                {eligiblePlayers.map((p) => {
                  const isPending = p.listing?.status === 'pending';
                  const isCancelling = cancellingId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`${styles.blockToggleRow} ${isPending ? styles.blockToggleRowActive : ''}`}
                      onClick={() => !isPending && setSelectedPlayer(p)}
                      style={{ cursor: isPending ? 'default' : 'pointer' }}
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
                        {isPending && (
                          <span className={styles.blockOnIndicator}>LISTED</span>
                        )}
                      </div>
                      <div className={styles.blockToggleRight}>
                        {isPending && (
                          <button
                            className={styles.blockToggleBtn}
                            onClick={(e) => handleCancelListing(p, e)}
                            disabled={isCancelling}
                            style={{ borderColor: 'var(--color-accent-red)', color: 'var(--color-accent-red)' }}
                          >
                            {isCancelling ? '…' : 'Cancel Listing'}
                          </button>
                        )}
                        {!isPending && (
                          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                            Click to List
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleCreateListing} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Minimum Bid (€m)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={minBid}
                onChange={(e) => setMinBid(Math.max(0, parseInt(e.target.value, 10) || 0))}
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
                Set to €0 to accept any offer. Minimum bid to start the auction.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)' }}>
                Buy Now Price (€m) — Optional
              </label>
              <input
                type="number"
                min={minBid + 1}
                step="1"
                value={buyNowPrice}
                onChange={(e) => setBuyNowPrice(e.target.value)}
                placeholder="No Buy Now price"
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
                Leave blank for auction only. If a user bids this amount, they win the player immediately.
              </span>
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
                {submitting ? 'Creating Listing…' : 'List Player'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
