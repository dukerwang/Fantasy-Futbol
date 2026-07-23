'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { formatPlayerName } from '@/lib/formatName';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import type { Player } from '@/types';
import styles from './league.module.css';

interface TopPerformersProps {
  latestCompletedGW: number | null;
  topPerformers: any[];
}

const POS_COLOR_MAP: Record<string, string> = {
  GK: 'var(--color-pos-gk)', CB: 'var(--color-pos-cb)', LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
  LWB: 'var(--color-pos-wb)', RWB: 'var(--color-pos-wb)',
  DM: 'var(--color-pos-dm)', CM: 'var(--color-pos-cm)',
  AM: 'var(--color-pos-am)', LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)', ST: 'var(--color-pos-st)',
};

export default function TopPerformers({ latestCompletedGW, topPerformers }: TopPerformersProps) {
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
      <div className={styles.rightCard}>
        <span className={styles.kickerLabel}>TOP PERFORMERS (GW {latestCompletedGW ?? '—'})</span>
        {topPerformers.length === 0 ? (
          <p className={styles.emptyHint}>Not available.</p>
        ) : (
          <div className={styles.perfList}>
            {topPerformers.map((perf: any, i: number) => {
              const player = perf.player;
              if (!player) return null;
              const pts = Number(perf.fantasy_points ?? 0);
              const posColor = POS_COLOR_MAP[player.primary_position] ?? 'var(--color-bg-secondary)';

              return (
                <div key={i} className={styles.perfRow}>
                  <div className={styles.perfPhotoMount}>
                    {player.photo_url ? (
                      <img src={player.photo_url} alt="" className={styles.perfPhoto} />
                    ) : (
                      <div className={styles.perfPhotoFallback}>
                        {formatPlayerName(player, 'initial_last').charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className={styles.perfDetails}>
                    <div className={styles.perfNameRow}>
                      <span className={styles.perfBadge} style={{ backgroundColor: posColor, color: 'white' }}>
                        {player.primary_position}
                      </span>
                      <button
                        type="button"
                        className={styles.perfName}
                        onClick={() => handlePlayerClick(player.id)}
                      >
                        {formatPlayerName(player, 'initial_last')}
                      </button>
                    </div>
                    <span className={styles.perfTeamName}>{player.pl_team}</span>
                  </div>
                  <div className={styles.perfScoreBadge}>
                    <span className={styles.perfPtsValue}>{pts.toFixed(2)}</span>
                    <span className={styles.perfPtsUnit}>pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <PlayerDetailsModal player={viewingPlayer} onClose={() => setViewingPlayer(null)} />
    </>
  );
}
