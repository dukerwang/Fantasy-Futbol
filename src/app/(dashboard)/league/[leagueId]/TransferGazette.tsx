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

function getTxLabel(type: string): string {
  switch (type) {
    case 'waiver_win':
    case 'faab_signing': return 'SIGNING';
    case 'drop': return 'DROP';
    case 'trade': return 'TRADE';
    case 'bid': return 'BID';
    case 'ir': return 'IR';
    case 'prize_payout': return 'PRIZE PAYOUT';
    default: return type.toUpperCase().replace(/_/g, ' ');
  }
}

function getTxKickerClass(type: string): string {
  switch (type) {
    case 'waiver_win':
    case 'faab_signing': return styles.kicker_signing;
    case 'drop': return styles.kicker_drop;
    case 'trade': return styles.kicker_trade;
    case 'bid': return styles.kicker_bid;
    case 'ir': return styles.kicker_ir;
    case 'prize_payout': return styles.kicker_payout;
    default: return '';
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
                const label = getTxLabel(tx.type);
                const kickerClass = getTxKickerClass(tx.type);
                const headlineText = generateTransactionHeadline(tx);

                return (
                  <div key={tx.id} className={styles.gazetteRow}>
                    <div className={styles.gazetteRowHeader}>
                      <span className={`${styles.gazetteRowKicker} ${kickerClass}`}>{label}</span>
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
