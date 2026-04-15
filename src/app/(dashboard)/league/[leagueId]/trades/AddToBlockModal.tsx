'use client';

import { useState } from 'react';
import PositionBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import styles from './trades.module.css';

interface SimplePlayer {
  id: string;
  name: string;
  web_name: string | null;
  pl_team?: string | null;
  market_value?: number | null;
  primary_position: string;
  on_trade_block?: boolean;
}

interface Props {
  myTeamId: string;
  myRoster: SimplePlayer[];
  onClose: () => void;
  onToggle: (playerId: string, isOnBlock: boolean) => void;
}

export default function AddToBlockModal({ myTeamId, myRoster, onClose, onToggle }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<Record<string, string>>({});
  const [localBlock, setLocalBlock] = useState<Record<string, boolean>>(
    Object.fromEntries(myRoster.map((p) => [p.id, !!p.on_trade_block]))
  );

  async function handleToggle(playerId: string) {
    const current = localBlock[playerId] ?? false;
    const next = !current;

    setLoadingId(playerId);
    setErrorId((prev) => ({ ...prev, [playerId]: '' }));

    const res = await fetch(`/api/teams/${myTeamId}/trade-block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, onTradeBlock: next }),
    });

    if (res.ok) {
      setLocalBlock((prev) => ({ ...prev, [playerId]: next }));
      onToggle(playerId, next);
    } else {
      const data = await res.json().catch(() => ({}));
      setErrorId((prev) => ({ ...prev, [playerId]: data.error ?? 'Failed to update.' }));
    }

    setLoadingId(null);
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.modalLabel}>MANAGE TRADE BLOCK</span>
            <h2 className={styles.modalTitle}>Your Roster</h2>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className={styles.modalHint}>
          Toggle players on or off the trade block. Other managers can see who you're willing to deal.
        </p>

        {myRoster.length === 0 ? (
          <p className={styles.modalEmpty}>Your roster is empty.</p>
        ) : (
          <div className={styles.blockToggleList}>
            {myRoster.map((p) => {
              const isOn = localBlock[p.id] ?? false;
              const isLoading = loadingId === p.id;
              const err = errorId[p.id];
              return (
                <div key={p.id} className={`${styles.blockToggleRow} ${isOn ? styles.blockToggleRowActive : ''}`}>
                  <div className={styles.blockToggleLeft}>
                    <PositionBadge position={p.primary_position as any} size="sm" />
                    <div className={styles.blockToggleInfo}>
                      <span className={styles.blockToggleName}>
                        {formatPlayerName(p, 'initial_last')}
                      </span>
                      <span className={styles.blockToggleClub}>
                        {p.pl_team ?? ''}
                        {p.market_value ? ` · £${p.market_value.toFixed(1)}m` : ''}
                      </span>
                    </div>
                    {isOn && (
                      <span className={styles.blockOnIndicator}>ON BLOCK</span>
                    )}
                  </div>
                  <div className={styles.blockToggleRight}>
                    {err && <span className={styles.blockToggleError}>{err}</span>}
                    <button
                      className={`${styles.blockToggleBtn} ${isOn ? styles.blockToggleBtnActive : ''}`}
                      onClick={() => handleToggle(p.id)}
                      disabled={isLoading}
                    >
                      {isLoading ? '…' : isOn ? '✓ On Block' : 'Add to Block'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
