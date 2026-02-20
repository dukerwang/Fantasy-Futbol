import type { Player, RosterEntry } from '@/types';
import PositionBadge from './PositionBadge';
import styles from './PlayerCard.module.css';

interface Props {
  player: Player;
  rosterEntry?: RosterEntry;
  fantasyPoints?: number;
  onDrop?: (playerId: string) => void;
  compact?: boolean;
}

export default function PlayerCard({ player, rosterEntry, fantasyPoints, onDrop, compact }: Props) {
  const statusLabel: Record<string, string> = {
    active: 'Starting',
    bench: 'Bench',
    ir: 'IR',
  };

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''} ${rosterEntry ? styles[`status_${rosterEntry.status}`] : ''}`}>
      <div className={styles.left}>
        <div className={styles.avatar}>
          {player.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.photo_url} alt={player.name} className={styles.photo} />
          ) : (
            <span className={styles.avatarPlaceholder}>
              {player.name.charAt(0)}
            </span>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{player.name}</span>
            {rosterEntry && (
              <span className={styles.statusBadge}>
                {statusLabel[rosterEntry.status]}
              </span>
            )}
          </div>
          <div className={styles.meta}>
            <PositionBadge position={player.primary_position} size="sm" />
            {player.secondary_positions.map((pos) => (
              <PositionBadge key={pos} position={pos} size="sm" />
            ))}
            <span className={styles.plTeam}>{player.pl_team}</span>
          </div>
        </div>
      </div>

      <div className={styles.right}>
        {fantasyPoints !== undefined && (
          <div className={styles.points}>
            <span className={styles.pointsValue}>{fantasyPoints.toFixed(1)}</span>
            <span className={styles.pointsLabel}>pts</span>
          </div>
        )}
        <div className={styles.value}>
          <span className={styles.valueAmount}>£{player.market_value}m</span>
        </div>
        {onDrop && (
          <button
            onClick={() => onDrop(player.id)}
            className={styles.dropBtn}
            aria-label={`Drop ${player.name}`}
          >
            Drop
          </button>
        )}
      </div>
    </div>
  );
}
