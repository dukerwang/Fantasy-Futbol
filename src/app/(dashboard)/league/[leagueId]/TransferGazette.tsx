'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { generateTransactionHeadline } from '@/lib/narrative/generators';
import { renderBoldedText } from '@/lib/narrative/boldText';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import type { Player } from '@/types';
import styles from './league.module.css';

interface TransferGazetteProps {
  activity: any[];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

function txCategoryStyle(type: string): { label: string; color: string; bg: string } {
  switch (type) {
    case 'waiver_win':
    case 'faab_signing': return { label: 'SIGNING', color: '#fff', bg: 'var(--color-accent-green)' };
    case 'drop': return { label: 'DROP', color: '#fff', bg: 'var(--color-accent-red)' };
    case 'trade': return { label: 'TRADE', color: '#fff', bg: '#3b82f6' };
    case 'bid': return { label: 'BID', color: '#92400e', bg: '#fde68a' };
    case 'ir': return { label: 'IR', color: '#fff', bg: '#6b7280' };
    case 'prize_payout': return { label: 'PRIZE PAYOUT', color: '#fff', bg: '#d97706' };
    default: return { label: type.toUpperCase().replace(/_/g, ' '), color: '#fff', bg: 'var(--color-text-muted)' };
  }
}

export default function TransferGazette({ activity }: TransferGazetteProps) {
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handlePlayerClick = async (playerId: string) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('players')
        .select(FULL_PLAYER_SELECT)
        .eq('id', playerId)
        .single();
      if (error) throw error;
      if (data) {
        setViewingPlayer(data as any);
      }
    } catch (err) {
      console.error('Failed to fetch player details:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className={styles.gazetteCard}>
        <div className={styles.gazetteHeaderBar}>
          <span className={styles.gazetteTitle}>TRANSFER GAZETTE & FEED</span>
          <span className={styles.gazetteDate}>Edition: {new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}</span>
        </div>
        
        <div className={styles.gazetteContent}>
          {activity.length === 0 ? (
            <div className={styles.emptyStateBox}>
              <p className={styles.emptyHint}>No activity yet this season.</p>
            </div>
          ) : (
            <div className={styles.gazetteList}>
              {activity.map((tx: any) => {
                const cat = txCategoryStyle(tx.type);
                const headlineText = generateTransactionHeadline(tx);

                return (
                  <div key={tx.id} className={styles.gazetteRow}>
                    <div className={styles.gazetteRowHeader}>
                      <span className={styles.gazetteRowKicker}>{cat.label}</span>
                      <span className={styles.gazetteRowTime}>{timeAgo(tx.processed_at)}</span>
                    </div>
                    <p className={styles.gazetteHeadline}>
                      {renderBoldedText(headlineText, handlePlayerClick)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PlayerDetailsModal player={viewingPlayer} onClose={() => setViewingPlayer(null)} />
    </>
  );
}
