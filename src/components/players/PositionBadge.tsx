import type { GranularPosition } from '@/types';
import styles from './PositionBadge.module.css';

interface Props {
  position: GranularPosition;
  size?: 'sm' | 'md';
}

const POSITION_BG: Record<GranularPosition, string> = {
  GK: 'var(--color-pos-gk)',
  CB: 'var(--color-pos-cb)',
  LB: 'var(--color-pos-fb)',
  RB: 'var(--color-pos-fb)',
  LWB: 'var(--color-pos-wb)',
  RWB: 'var(--color-pos-wb)',
  DM: 'var(--color-pos-dm)',
  CM: 'var(--color-pos-cm)',
  AM: 'var(--color-pos-am)',
  LW: 'var(--color-pos-lw)',
  RW: 'var(--color-pos-rw)',
  ST: 'var(--color-pos-st)',
};

export default function PositionBadge({ position, size = 'md' }: Props) {
  return (
    <span
      className={`${styles.badge} ${styles[`size_${size}`]}`}
      style={{ backgroundColor: POSITION_BG[position], color: '#FFFFFF' }}
    >
      {position}
    </span>
  );
}
