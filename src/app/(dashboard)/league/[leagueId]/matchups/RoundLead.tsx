'use client';

import { renderBoldedText } from '@/lib/narrative/boldText';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import styles from './matchups.module.css';

/**
 * The round's standfirst — one generated sentence about the gameweek, sitting
 * between the masthead and the panel.
 *
 * It was `RoundupGazetteBanner`: the same sentence inside a bordered card with
 * a tracked serif "ROUNDUP GAZETTE" kicker and a 4px accent left-rule. The
 * writing is unchanged and the costume is gone. Three reasons, in order of how
 * much they cost: the kicker and the rule are two devices introducing one
 * sentence; 2.0 gives the italic/tracked serif exactly one job, the section or
 * card heading, which a kicker is not; and a bordered box here was a fourth
 * elevation declaration on a page that now has one.
 *
 * A standfirst is a paragraph set smaller than the headline above it. That is
 * the whole device, and it is what this is now.
 */
export default function RoundLead({ summaryText }: { summaryText: string }) {
  const { openPlayerById: handlePlayerClick } = usePlayerCard();

  return (
    <p className={styles.lead}>
      {renderBoldedText(summaryText, handlePlayerClick)}
    </p>
  );
}
