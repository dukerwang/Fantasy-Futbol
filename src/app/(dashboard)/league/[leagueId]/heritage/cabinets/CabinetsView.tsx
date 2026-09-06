'use client';

/**
 * Heritage — Trophy Cabinets.
 *
 * Every club's silverware, each cabinet standing in its own studio sweep. The
 * display treatment is ported wholesale from the old per-club cabinet, including
 * the two attempts recorded there that did not work: a dark green back panel
 * with ledges read as a chalkboard, and a wall-meets-floor sweep put half the
 * objects on visibly darker ground. One soft field with a warm pool of light in
 * it; each trophy is grounded by its own contact shadow.
 */

import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import { HONOUR_LABELS } from '@/lib/honours/getClubHonours';
import type { BoardClub } from '@/lib/heritage/honoursBoard';
import HeritageNav from '../HeritageNav';
import styles from '../heritage.module.css';

interface Props {
  leagueId: string;
  clubs: BoardClub[];
  totalTrophies: number;
  viewerTeamId: string | null;
}

export default function CabinetsView({ leagueId, clubs, totalTrophies, viewerTeamId }: Props) {
  const decorated = clubs.filter((c) => c.total > 0);
  const bare = clubs.filter((c) => c.total === 0);

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Trophy Cabinets</h1>
          <p className={styles.subtitle}>
            {totalTrophies
              ? `${totalTrophies} ${totalTrophies === 1 ? 'object' : 'objects'} across ${decorated.length} ${decorated.length === 1 ? 'club' : 'clubs'}`
              : 'Nothing has been won yet'}
          </p>
        </div>
      </div>

      <HeritageNav leagueId={leagueId} active="Trophy Cabinets" />

      {decorated.map((c) => (
        <div key={c.teamId} className={styles.block}>
          <div className={styles.sect}>
            <h2 className={styles.sectT}>{c.teamName}</h2>
            <span className={styles.sectHint}>
              {c.managerName ?? '—'}{c.teamId === viewerTeamId ? ' · you' : ''}
            </span>
            <span className={styles.sectMore}>
              {c.total} {c.total === 1 ? 'trophy' : 'trophies'}
            </span>
          </div>
          <div className={styles.box}>
            <div className={styles.cabinets}>
              <div className={styles.pool} aria-hidden="true" />
              <div className={styles.cabinetStage}>
                {c.honours.flatMap((g) =>
                  g.seasons.map((season) => (
                    <div key={`${g.kind}-${season}`} className={styles.stand}>
                      <Trophy kind={g.kind} size="hero" height={168} season={season} />
                      <div className={styles.cabinetPlate}>{HONOUR_LABELS[g.kind]}</div>
                      <div className={styles.plate}>{season}</div>
                    </div>
                  )),
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {bare.length > 0 && (
        <div className={styles.block}>
          <div className={styles.sect}>
            <h2 className={styles.sectT}>Still Waiting</h2>
            <span className={styles.sectHint}>Clubs yet to win anything</span>
          </div>
          <div className={styles.box}>
            {bare.map((c) => (
              <div
                key={c.teamId}
                className={c.teamId === viewerTeamId ? styles.boardRowMine : styles.boardRow}
              >
                <span />
                <CrestBadge
                  config={c.crestConfig}
                  size={38}
                  teamName={c.teamName}
                  teamId={c.teamId}
                  interactive={false}
                />
                <div className={styles.boardId}>
                  <div className={c.teamId === viewerTeamId ? styles.boardNameMine : styles.boardName}>
                    {c.teamName}
                  </div>
                  <div className={styles.boardMgr}>
                    {c.managerName ?? '—'}{c.teamId === viewerTeamId ? ' · you' : ''}
                  </div>
                </div>
                <span />
                <span />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
