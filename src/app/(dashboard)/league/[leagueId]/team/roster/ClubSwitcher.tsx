'use client';

import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import type { ClubSwitcherEntry } from '@/lib/teams/loadClubView';
import { clubHref } from '@/lib/teams/clubHref';
import styles from './club.module.css';

/**
 * Every club in the league, along the bottom of the masthead.
 *
 * This replaced a separate `/clubs` index page. An index was a detour: you were
 * already looking at a squad, and what you wanted next was the squad beside it,
 * not a lobby listing all of them. Reading one club and moving to the next is
 * one continuous act, so the strip travels with the page — the same control in
 * the same place whether you're on your own club or someone else's.
 *
 * Clicking navigates rather than opening the peek drawer: from here you want
 * the full file. The drawer stays the quick glance from a crest elsewhere
 * (standings, a listing, a player card's owner badge).
 */
export default function ClubSwitcher({
  leagueId,
  clubs,
  currentTeamId,
}: {
  leagueId: string;
  clubs: ClubSwitcherEntry[];
  currentTeamId: string;
}) {
  if (clubs.length <= 1) return null;

  return (
    <nav className={styles.switcher} aria-label="Clubs in this league">
      <span className={`${styles.tbLabel} ${styles.switcherLabel}`}>Clubs</span>
      <div className={styles.switcherStrip}>
        {clubs.map((c) => {
          const isCurrent = c.teamId === currentTeamId;
          return (
            <NavigationLink
              key={c.teamId}
              href={clubHref(leagueId, c.teamId, c.isMine)}
              className={`${styles.switcherItem} ${isCurrent ? styles.switcherItemOn : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
              title={c.isMine ? `${c.name} (yours)` : c.name}
            >
              <CrestBadge config={c.crestConfig ?? undefined} teamName={c.name} size={22} />
              <span className={styles.switcherName}>{c.name}</span>
            </NavigationLink>
          );
        })}
      </div>
    </nav>
  );
}
