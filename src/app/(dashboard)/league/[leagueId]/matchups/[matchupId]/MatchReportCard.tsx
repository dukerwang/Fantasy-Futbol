'use client';

import { useState } from 'react';
import type { MatchReport } from '@/lib/narrative/matchReport';
import styles from './matchup-detail.module.css';

export default function MatchReportCard({ report }: { report: MatchReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.reportContainer}>
      <div className={styles.reportHeader}>
        <span className={styles.reportKicker}>THE FOOTBALL GAZETTE</span>
        <span className={styles.reportByline}>{report.byline}</span>
      </div>
      
      <h2 className={styles.reportHeadline}>{report.headline}</h2>
      
      {/* Lead Paragraph */}
      <p className={styles.reportLead}>
        {report.leadParagraph}
      </p>

      {expanded && (
        <div className={styles.reportExpandedContent}>
          <div className={styles.reportGrid}>
            <div className={styles.reportCol}>
              <h4 className={styles.reportSectionHeader}>🌟 STAR OF THE MATCH</h4>
              <p className={styles.reportDetailText}>{report.starHighlight}</p>
            </div>
            <div className={styles.reportCol}>
              <h4 className={styles.reportSectionHeader}>⚠️ BOARDROOM NOTES</h4>
              <p className={styles.reportDetailText}>{report.disappointmentHighlight}</p>
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
  );
}
