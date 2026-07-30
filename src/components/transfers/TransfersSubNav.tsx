'use client';

import NavigationLink from '@/components/ui/NavigationLink';
import { usePathname } from 'next/navigation';
import type { TransfersCounts } from '@/lib/transfers/buildTransfersModel';
import styles from './TransfersSubNav.module.css';

/**
 * `Market · Auctions n · Listings n · Free Agency n · Deals n`
 *
 * Auctions get their own page AND stay visible in place — a listed player under
 * the hammer is still on the Listings board, a free agent under the hammer is
 * still in Free Agency. The page is the cross-cutting view (everything closing,
 * in time order, with bid history); the inline states are how you find a player
 * you were already looking for. Neither is the "real" one.
 */

interface Props {
  leagueId: string;
  counts: TransfersCounts;
}

export default function TransfersSubNav({ leagueId, counts }: Props) {
  const pathname = usePathname();
  const base = `/league/${leagueId}/transfers`;

  const items = [
    { href: base, label: 'Market', count: null as number | null },
    { href: `${base}/auctions`, label: 'Auctions', count: counts.auctions },
    { href: `${base}/listings`, label: 'Listings', count: counts.listings },
    { href: `${base}/free-agents`, label: 'Free Agency', count: counts.freeAgents },
    { href: `${base}/deals`, label: 'Deals', count: counts.deals },
  ];

  return (
    <nav className={styles.nav} aria-label="Transfer market sections">
      {items.map((item) => {
        // Exact match for Market, prefix for the rest — otherwise Market, being a
        // prefix of every sibling, would light up on all four pages.
        const active = item.href === base ? pathname === base : pathname?.startsWith(item.href);

        return (
          <NavigationLink
            key={item.href}
            href={item.href}
            className={`${styles.item} ${active ? styles.itemActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
            {item.count !== null && <span className={styles.count}>{item.count}</span>}
          </NavigationLink>
        );
      })}
    </nav>
  );
}
