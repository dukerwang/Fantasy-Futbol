import type { GranularPosition } from '@/types';
import styles from './PositionBadge.module.css';

interface Props {
  position: GranularPosition;
  size?: 'sm' | 'md';
}

export default function PositionBadge({ position, size = 'md' }: Props) {
  return (
    <span className={`${styles.badge} ${styles[`pos_${position}`]} ${styles[`size_${size}`]}`}>
      {position}
    </span>
  );
}
