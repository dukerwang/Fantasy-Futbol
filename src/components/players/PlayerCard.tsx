'use client';

import type { Player } from '@/types';
import PositionBadge from './PositionBadge';
import { getPlayerDisplayName, playerInitial } from '@/lib/players/displayName';
import styles from './PlayerCard.module.css';

interface Props {
  player: Player;
  isCompact?: boolean;
  status?: 'active' | 'bench' | 'ir' | 'taxi' | 'reserves';
  onClick?: () => void;
  action?: {
    type: 'drop' | 'bid' | 'bid_pending';
    onAction?: () => void;
  };
}

export default function PlayerCard({
  player,
  isCompact = false,
  status = 'active',
  onClick,
  action,
}: Props) {
  const statusClass = styles[`status_${status}`] || '';
  const nameToDisplay = getPlayerDisplayName(player, 'initial_last');

  return (
    <div
      className={`${styles.card} ${isCompact ? styles.compact : ''} ${statusClass} ${onClick ? styles.clickable : ''}`}
      onClick={onClick}
    >
      <div className={styles.left}>
        <div className={styles.avatar}>
          {player.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.photo_url}
              alt={player.name}
              className={styles.photo}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {playerInitial(player)}
            </div>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{nameToDisplay}</span>
            {player.fpl_status && player.fpl_status !== 'a' && (
              <span
                className={`${styles.statusBadge} ${player.fpl_status === 'd' ? styles.statusBadgeDoubtful : ''}`}
              >
                {player.fpl_status.toUpperCase()}
              </span>
            )}
          </div>
          <div className={styles.meta}>
            <PositionBadge position={player.primary_position} size="sm" />
            <span className={styles.plTeam}>{player.pl_team}</span>
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.pointsContainer}>
          <span className={styles.pointsValue}>
            {player.total_points != null ? player.total_points.toFixed(1) : 'n/a'}
          </span>
          <span className={styles.pointsLabel}>Points</span>
          {!isCompact && player.ppg != null && player.ppg > 0 && (
            <div className={styles.projectedPoints}>
              PPG: <span className={styles.projectedValue}>{player.ppg.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className={styles.value}>
          <span className={styles.valueAmount}>
            {player.market_value != null ? `€${player.market_value}m` : 'n/a'}
          </span>
        </div>

        {action && (
          <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
            {action.type === 'drop' && (
              <button className={styles.dropBtn} onClick={action.onAction}>
                Drop
              </button>
            )}
            {action.type === 'bid' && (
              <button className={styles.bidBtn} onClick={action.onAction}>
                Bid
              </button>
            )}
            {action.type === 'bid_pending' && (
              <span className={styles.bidPendingTag}>Bid Placed</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
