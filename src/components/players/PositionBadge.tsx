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
        // A stable, unhashed hook so `.g-namerow` in globals.css can give the
        // badge its optical lift when it sits beside a player's name. It rides
        // on the component rather than on each call site, because "remember to
        // pass a class" is exactly the step that gets forgotten — and a badge
        // that is conditionally rendered makes a :first-child selector wrong.
        'g-poschip',
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
