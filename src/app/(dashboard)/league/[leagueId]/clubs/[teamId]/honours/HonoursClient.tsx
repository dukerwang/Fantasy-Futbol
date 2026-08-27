'use client';

import CrestBadge from '@/components/crest/CrestBadge';
import NavigationLink from '@/components/ui/NavigationLink';
import Trophy from '@/components/trophies/Trophy';
import type { CrestConfig } from '@/components/crest/types';
import { HONOUR_LABELS, type Honour } from '@/lib/honours/getClubHonours';
import styles from './honours.module.css';

interface Props {
  leagueId: string;
  teamId: string;
  clubName: string;
  manager: string;
  crestConfig: CrestConfig | null;
  /** Newest first. One entry per trophy, not per competition. */
  honours: Honour[];
}

/**
 * The trophy cabinet.
 *
 * Every win is its own object standing on the display, with its own year cut
 * into its base and the club's colours on both handles — a shelf of things,
 * not one picture per competition with a list of dates under it.
 *
 * The cabinet holds what this club HAS won and nothing else. An earlier version
 * also showed bare plinths for the competitions it hadn't, which turned a
 * trophy room into a list of failures.
 */
export default function HonoursClient({
  leagueId, teamId, clubName, manager, crestConfig, honours,
}: Props) {
  const club = crestConfig
    ? { primary: crestConfig.primaryColor, secondary: crestConfig.secondaryColor }
    : null;

  const firstWon = honours.length ? honours[honours.length - 1].season : null;

  return (
    <div className={`${styles.page} g-page`}>
      <nav className={styles.crumbs}>
        <NavigationLink href={`/league/${leagueId}/clubs/${teamId}`}>{clubName}</NavigationLink>
        <span className={styles.dot}>/</span>
        <span className={styles.here}>Honours</span>
      </nav>

      <header className={styles.head}>
        <CrestBadge config={crestConfig ?? undefined} teamName={clubName} teamId={teamId} size={64} />
        <div className={styles.headText}>
          <div className="g-label">Trophy cabinet</div>
          <h1 className={styles.club}>{clubName}</h1>
          <div className={styles.meta}>
            <span>{manager}</span>
            {honours.length > 0 && (
              <>
                <span className={styles.dot}>·</span>
                <span>{honours.length === 1 ? '1 trophy' : `${honours.length} trophies`}</span>
                <span className={styles.dot}>·</span>
                <span>first won {firstWon}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* The display: one even field with a warm pool of light in it. No case,
          no shelf boards, no container around any individual trophy — each is
          grounded by its own contact shadow and its own reflection. */}
      <div className={styles.display}>
        <div className={styles.pool} aria-hidden="true" />
        {honours.length === 0 ? (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>No trophies yet</h2>
            <p className={styles.emptyBody}>
              {`${clubName} hasn’t won anything. The first honours are awarded at the end of the season.`}
            </p>
          </div>
        ) : (
          <div className={styles.stage}>
            {honours.map((h) => (
              <div className={styles.stand} key={`${h.kind}-${h.season}`}>
                <Trophy kind={h.kind} size="hero" season={h.season} club={club} />
                <div className={styles.mirrorWell} aria-hidden="true">
                  <div className={styles.mirror}>
                    <Trophy kind={h.kind} size="hero" season={h.season} club={club} />
                  </div>
                </div>
                <div className={styles.plate}>{h.label || HONOUR_LABELS[h.kind]}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
