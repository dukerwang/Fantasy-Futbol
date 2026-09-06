/**
 * Heritage's own nav, shown on every surface of the hub.
 *
 * The tab device is League Home's (`_home/home.module.css` .heroTab /
 * .heroTabActive): 12px bold, a 2px underline in accent ink, sitting ON the
 * masthead's ink rule rather than under its own. It scrolls horizontally on a
 * phone rather than wrapping, so the five destinations stay one row.
 */

import NavigationLink from '@/components/ui/NavigationLink';
import styles from './heritage.module.css';

export type HeritageTab =
  | 'Overview'
  | 'Head-to-Head'
  | 'Seasons'
  | 'Record Book'
  | 'Trophy Cabinets';

const TABS: { label: HeritageTab; href: string }[] = [
  { label: 'Overview', href: '' },
  { label: 'Head-to-Head', href: '/head-to-head' },
  { label: 'Seasons', href: '/seasons' },
  { label: 'Record Book', href: '/records' },
  { label: 'Trophy Cabinets', href: '/cabinets' },
];

export default function HeritageNav({
  leagueId,
  active,
}: {
  leagueId: string;
  active: HeritageTab;
}) {
  return (
    <nav className={styles.nav} aria-label="Heritage sections">
      {TABS.map((t) => (
        <NavigationLink
          key={t.label}
          href={`/league/${leagueId}/heritage${t.href}`}
          className={t.label === active ? styles.tabActive : styles.tab}
          aria-current={t.label === active ? 'page' : undefined}
        >
          {t.label}
        </NavigationLink>
      ))}
    </nav>
  );
}
