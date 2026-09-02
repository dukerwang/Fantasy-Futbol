'use client';

import styles from './AuctionTimingHelp.module.css';

/**
 * One "?" per page explaining auction timing — not one per card.
 *
 * SVG, not a text glyph: a "?" or "i" character's ink sits in a different
 * spot relative to its line box depending on the font, so flexbox centering
 * a text glyph inside a circle reads as "off center" more often than not.
 * An SVG's coordinates are exact, so centering it is centering it.
 */
export default function AuctionTimingHelp() {
  return (
    <span className={styles.help}>
      <button type="button" className={styles.toggle} aria-describedby="auction-timing-help" aria-label="How auction timing works">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <circle cx="5" cy="2.25" r="1" fill="currentColor" />
          <rect x="4.25" y="4.5" width="1.5" height="4.25" rx="0.75" fill="currentColor" />
        </svg>
      </button>
      <span role="tooltip" id="auction-timing-help" className={styles.tip}>
        <span>Bigger fees get longer minimums.</span>
        <span>Every bid resets the clock.</span>
        <span>Nothing closes overnight.</span>
      </span>
    </span>
  );
}
