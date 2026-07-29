'use client';

import { useState } from 'react';
import type { MatchReport } from '@/lib/narrative/matchReport';
import { renderBoldedText } from '@/lib/narrative/boldText';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import { Icon } from '@/components/ui/Icon';
import styles from './matchup-detail.module.css';

export default function MatchReportCard({ report }: { report: MatchReport }) {
  const [expanded, setExpanded] = useState(false);
  const { openPlayerById: handlePlayerClick } = usePlayerCard();

  return (
    <>
      <div className={styles.reportContainer}>
        <div className={styles.reportHeader}>
          <span className={styles.reportKicker}>THE FOOTBALL GAZETTE</span>
          <span className={styles.reportByline}>{report.byline}</span>
        </div>
        
        <h2 className={styles.reportHeadline}>{renderBoldedText(report.headline, handlePlayerClick)}</h2>
        
        {/* Lead Paragraph */}
        <p className={styles.reportLead}>
          {renderBoldedText(report.leadParagraph, handlePlayerClick)}
        </p>

        {expanded && (
          <div className={styles.reportExpandedContent}>
            <div className={styles.reportGrid}>
              <div className={styles.reportCol}>
                <h4 className={styles.reportSectionHeader} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="star" size={16} style={{ color: 'var(--color-accent-green, #3A6B4A)' }} /> STAR OF THE MATCH
                </h4>
                <p className={styles.reportDetailText}>{renderBoldedText(report.starHighlight, handlePlayerClick)}</p>
              </div>
              <div className={styles.reportCol}>
                <h4 className={styles.reportSectionHeader} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="alert" size={16} style={{ color: 'var(--color-accent-red, #ef4444)' }} /> BOARDROOM NOTES
                </h4>
                <p className={styles.reportDetailText}>{renderBoldedText(report.disappointmentHighlight, handlePlayerClick)}</p>
              </div>
            </div>
          </div>
        )}

        <button 
          onClick={() => setExpanded(!expanded)} 
          className={styles.reportToggleButton}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide Press Summary ↑' : 'Read Press Summary ↓'}
        </button>
      </div>

    </>
  );
}

