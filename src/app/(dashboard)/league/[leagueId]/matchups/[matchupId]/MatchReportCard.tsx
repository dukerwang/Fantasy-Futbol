'use client';

import { useState } from 'react';
import type { MatchReport } from '@/lib/narrative/matchReport';
import { renderBoldedText } from '@/lib/narrative/boldText';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import { Icon } from '@/components/ui/Icon';
import styles from './matchup-detail.module.css';

/**
 * The match report — Gaffa 2.0.
 *
 * It was a newspaper clipping: a tracked serif "THE FOOTBALL GAZETTE" kicker, a
 * 2px double rule, an italic byline and a 2.25rem accent drop cap on the lead.
 * The generated writing is unchanged; the costume is gone.
 *
 * Four devices were introducing one paragraph, and 2.0 gives the italic/tracked
 * serif exactly one job — the section or card heading, which a kicker and a
 * byline are not. What survives maps cleanly onto roles the system already has:
 * the kicker is the panel's one rationed `.g-label`, the byline is the dateline
 * `.g-label-quiet` exists for, and the headline and lead are simply a headline
 * and a lead. The report is good enough that it does not need to dress up as
 * one.
 */
export default function MatchReportCard({ report }: { report: MatchReport }) {
  const [expanded, setExpanded] = useState(false);
  const { openPlayerById, prefetchPlayer } = usePlayerCard();
  const handlePlayerClick = (id: string) => openPlayerById(id);
  const handlePlayerPrefetch = (id: string) => prefetchPlayer({ id });

  return (
    <section className={`${styles.report} g-panel`}>
      <div className={styles.reportHead}>
        <span className={`g-label ${styles.reportKicker}`}>Match report</span>
        <span className={`g-label-quiet ${styles.reportByline}`}>{report.byline}</span>
      </div>

      <h2 className={styles.reportHeadline}>
        {renderBoldedText(report.headline, handlePlayerClick, handlePlayerPrefetch)}
      </h2>

      <p className={styles.reportLead}>
        {renderBoldedText(report.leadParagraph, handlePlayerClick, handlePlayerPrefetch)}
      </p>

      {expanded && (
        <div className={styles.reportExpanded}>
          <div className={styles.reportGrid}>
            <div className={styles.reportCol}>
              <h3 className={styles.reportColHead}>
                <Icon name="star" size={15} className={styles.reportIconStar} />
                Star of the Match
              </h3>
              <p className={styles.reportDetail}>
                {renderBoldedText(report.starHighlight, handlePlayerClick, handlePlayerPrefetch)}
              </p>
            </div>
            <div className={styles.reportCol}>
              <h3 className={styles.reportColHead}>
                <Icon name="alert" size={15} className={styles.reportIconAlert} />
                Boardroom Notes
              </h3>
              <p className={styles.reportDetail}>
                {renderBoldedText(report.disappointmentHighlight, handlePlayerClick, handlePlayerPrefetch)}
              </p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className={styles.reportToggle}
        aria-expanded={expanded}
      >
        {expanded ? 'Show less ↑' : 'Show more ↓'}
      </button>
    </section>
  );
}
