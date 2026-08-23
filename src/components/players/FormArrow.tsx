'use client';

import type { CSSProperties } from 'react';
import styles from './FormArrow.module.css';

/**
 * eFootball-style form indicator. The arrow rotates continuously between
 * straight down and straight up based on the player's form rating (avg match
 * rating over their last 5 qualifying appearances).
 *
 * FLOOR/CEIL are calibrated against the real rating distribution rather than the
 * nominal 1-10 scale, which is far wider than what players actually occupy:
 * p10 sits at 6.0, the median at 6.6 and p90 at 7.4.
 *
 * The floor sits AT p10 by choice, so anything under 6.0 reads as full-down
 * rather than getting its own gradation. Measured against the live distribution
 * that puts the five colour bands at 8/26/37/19/9 percent for a 5.5 floor
 * versus 28/38/15/14/5 for this 6.0 one, and pins 12% at full-down rather than
 * 3%. The bottom-weighting is deliberate — it is not a bug to "fix" by lowering
 * the floor back. If the banding ever needs rebalancing, raise CEIL with it
 * rather than dropping FLOOR.
 */
const FLOOR = 6.0;
const CEIL = 8.0;

const TONES = ['tone0', 'tone1', 'tone2', 'tone3', 'tone4'] as const;
const DESCRIPTIONS = [
  'well below par',
  'below par',
  'steady',
  'in good form',
  'in excellent form',
] as const;

function formArrowFraction(rating: number): number {
  return Math.max(0, Math.min(1, (rating - FLOOR) / (CEIL - FLOOR)));
}

interface Props {
  rating: number | null | undefined;
  size?: number;
  /** Render the numeric rating alongside the arrow. */
  showValue?: boolean;
  className?: string;
}

export default function FormArrow({ rating, size = 16, showValue = false, className }: Props) {
  // form_rating is 0 rather than null when a player has no qualifying
  // appearances in the resolved season, so treat both as "no data".
  const hasData = rating != null && rating > 0;

  if (!hasData) {
    return (
      <span
        className={`${styles.wrap} ${styles.empty} ${className ?? ''}`}
        style={{ '--arrow-size': `${size}px` } as CSSProperties}
        role="img"
        aria-label="No form data"
        title="No form data yet"
      >
        <svg viewBox="0 0 24 24" className={styles.svg} aria-hidden="true">
          <path d="M6 12h12" />
        </svg>
        {showValue && <span className={styles.value}>—</span>}
      </span>
    );
  }

  const t = formArrowFraction(rating);
  // Base glyph points right, so -90deg is straight up and +90deg straight down.
  const angle = (0.5 - t) * 180;
  const band = Math.min(TONES.length - 1, Math.floor(t * TONES.length));
  const label = `Form ${rating.toFixed(2)} — ${DESCRIPTIONS[band]}`;

  return (
    <span
      className={`${styles.wrap} ${styles[TONES[band]]} ${className ?? ''}`}
      style={{ '--arrow-size': `${size}px` } as CSSProperties}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" className={styles.svg} aria-hidden="true">
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '12px 12px' }}>
          <path d="M4 12h13M12 6l6 6-6 6" />
        </g>
      </svg>
      {showValue && <span className={styles.value}>{rating.toFixed(2)}</span>}
    </span>
  );
}
