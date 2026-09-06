'use client';

/**
 * Heritage — Head-to-Head index.
 *
 * Every pairing the league has produced, the viewer's own first. A row is a
 * fixture line: two crests either side of the record between them.
 */

import CrestBadge from '@/components/crest/CrestBadge';
import NavigationLink from '@/components/ui/NavigationLink';
import type { CrestConfig } from '@/components/crest/types';
import type { HeadToHead } from '@/lib/heritage/headToHead';
import HeritageNav from '../HeritageNav';
import styles from '../heritage.module.css';

interface Club {
  teamId: string;
  teamName: string;
  managerName: string | null;
  crestConfig: CrestConfig | null;
}

interface Props {
  leagueId: string;
  pairings: HeadToHead[];
  clubs: Club[];
  viewerTeamId: string | null;
}

export default function RivalriesView({ leagueId, pairings, clubs, viewerTeamId }: Props) {
  const byId = new Map(clubs.map((c) => [c.teamId, c]));
  const mine = pairings.filter((p) => p.teamId === viewerTeamId || p.opponentId === viewerTeamId);
  const rest = pairings.filter((p) => !mine.includes(p));

  function Row({ h }: { h: HeadToHead }) {
    const a = byId.get(h.teamId);
    const b = byId.get(h.opponentId);
    if (!a || !b) return null;
    const href = h.teamId === viewerTeamId || !viewerTeamId
      ? `/league/${leagueId}/heritage/head-to-head/${h.opponentId}`
      : `/league/${leagueId}/heritage/head-to-head/${h.teamId}`;
    return (
      <NavigationLink href={href} className={styles.pairRow}>
        <div className={styles.pairSideA}>
          <span className={styles.pairName}>{a.teamName}</span>
          <CrestBadge config={a.crestConfig} size={28} teamName={a.teamName} teamId={a.teamId} interactive={false} />
        </div>
        <div className={styles.pairScore}>
          <span className={styles.pairW}>{h.won}</span>
          <span className={styles.sep}>·</span>
          <span className={styles.pairD}>{h.drawn}</span>
          <span className={styles.sep}>·</span>
          <span className={styles.pairL}>{h.lost}</span>
        </div>
        <div className={styles.pairSideB}>
          <CrestBadge config={b.crestConfig} size={28} teamName={b.teamName} teamId={b.teamId} interactive={false} />
          <span className={styles.pairName}>{b.teamName}</span>
        </div>
        <span className={styles.pairMeta}>{h.played} {h.played === 1 ? 'meeting' : 'meetings'}</span>
      </NavigationLink>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Head-to-Head</h1>
          <p className={styles.subtitle}>Every pairing this league has produced, league and cups</p>
        </div>
      </div>

      <HeritageNav leagueId={leagueId} active="Head-to-Head" />

      {pairings.length === 0 ? (
        <p className={styles.empty}>
          No club has met another yet. Records appear once the first gameweek is scored.
        </p>
      ) : (
        <>
          {mine.length > 0 && (
            <div className={styles.block}>
              <div className={styles.sect}>
                <h2 className={styles.sectT}>Your Rivalries</h2>
                <span className={styles.sectHint}>Most-played first</span>
              </div>
              <div className={styles.box}>{mine.map((h) => <Row key={`${h.teamId}-${h.opponentId}`} h={h} />)}</div>
            </div>
          )}

          {rest.length > 0 && (
            <div className={styles.block}>
              <div className={styles.sect}>
                <h2 className={styles.sectT}>Around the League</h2>
                <span className={styles.sectHint}>Pairings you are not part of</span>
              </div>
              <div className={styles.box}>{rest.map((h) => <Row key={`${h.teamId}-${h.opponentId}`} h={h} />)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
