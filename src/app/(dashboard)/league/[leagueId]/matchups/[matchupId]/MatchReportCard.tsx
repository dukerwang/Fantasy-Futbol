'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import type { MatchReport } from '@/lib/narrative/matchReport';
import { renderBoldedText } from '@/lib/narrative/boldText';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import { Icon } from '@/components/ui/Icon';
import type { Player } from '@/types';
import styles from './matchup-detail.module.css';

export default function MatchReportCard({ report }: { report: MatchReport }) {
  const [expanded, setExpanded] = useState(false);
  const [viewingPlayer, setViewingPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const params = useParams();
  const leagueId = params?.leagueId as string | undefined;

  const handlePlayerClick = async (playerId: string) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const query = leagueId ? `?leagueId=${leagueId}` : '';
      const res = await fetch(`/api/players/${playerId}${query}`);
      if (!res.ok) throw new Error('Failed to fetch details');
      const data = await res.json();
      if (data.player) {
        setViewingPlayer(data.player as Player);
      }
    } catch (err) {
      console.error('Failed to fetch player details:', err);
    } finally {
      setIsLoading(false);
    }
  };

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

      <PlayerDetailsModal player={viewingPlayer} onClose={() => setViewingPlayer(null)} />
    </>
  );
}

