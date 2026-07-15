'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
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

  const params = useParams();
  const leagueId = params?.leagueId as string | undefined;

  const handlePlayerClick = async (playerId: string) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const query = leagueId ? `?leagueId=${leagueId}` : '';
      const res = await fetch(`/api/players/${playerId}${query}`);
      if (!res.ok) throw new Error('Failed to fetch details');
      const data = await res.json();
      if (data.player) {
        setViewingPlayer(data.player as Player);
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
