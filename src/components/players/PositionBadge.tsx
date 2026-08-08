import type { GranularPosition } from '@/types';
import styles from './PositionBadge.module.css';

interface Props {
  position: GranularPosition;
  size?: 'sm' | 'md';
}

/* Left/right pairs share a hue (LB/RB, LWB/RWB, LW/RW), so the side is
   carried by a clipped corner as well as by the letters. Without it the
   spine would be leaning on colour alone to separate two positions that
   are genuinely different roles. */
const SIDE: Partial<Record<GranularPosition, 'l' | 'r'>> = {
  LB: 'l', LWB: 'l', LW: 'l',
  RB: 'r', RWB: 'r', RW: 'r',
};

export default function PositionBadge({ position, size = 'md' }: Props) {
  const side = SIDE[position];
  return (
    <span
      className={[
        styles.badge,
        styles[`size_${size}`],
        styles[`pos_${position}`],
        side ? styles[`side_${side}`] : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {position}
    </span>
  );
}
