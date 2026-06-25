'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { renderBoldedText } from '@/lib/narrative/boldText';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import type { Player } from '@/types';
import styles from './matchups.module.css';

interface RoundupGazetteBannerProps {
  summaryText: string;
}

export default function RoundupGazetteBanner({ summaryText }: RoundupGazetteBannerProps) {
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
      <div className={styles.gazetteBanner}>
        <span className={styles.gazetteBannerTitle}>ROUNDUP GAZETTE</span>
        <p className={styles.gazetteBannerText}>
          {renderBoldedText(summaryText, handlePlayerClick)}
        </p>
      </div>

      <PlayerDetailsModal player={viewingPlayer} onClose={() => setViewingPlayer(null)} />
    </>
  );
}
