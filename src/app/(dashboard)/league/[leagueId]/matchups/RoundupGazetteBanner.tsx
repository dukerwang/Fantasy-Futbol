'use client';

import { renderBoldedText } from '@/lib/narrative/boldText';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import styles from './matchups.module.css';

interface RoundupGazetteBannerProps {
  summaryText: string;
}

export default function RoundupGazetteBanner({ summaryText }: RoundupGazetteBannerProps) {
  const { openPlayerById: handlePlayerClick } = usePlayerCard();

  return (
    <div className={styles.gazetteBanner}>
      <span className={styles.gazetteBannerTitle}>ROUNDUP GAZETTE</span>
      <p className={styles.gazetteBannerText}>
        {renderBoldedText(summaryText, handlePlayerClick)}
      </p>
    </div>
  );
}
