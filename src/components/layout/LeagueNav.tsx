'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './LeagueNav.module.css';

interface Props {
    leagueId: string;
    leagueStatus: string;
}

export default function LeagueNav({ leagueId, leagueStatus }: Props) {
    const pathname = usePathname();

    const links = [
        { href: `/league/${leagueId}`, label: 'League', exact: true },
        { href: `/league/${leagueId}/team`, label: 'My Team' },
        { href: `/league/${leagueId}/matchups`, label: 'Matchups' },
        { href: `/league/${leagueId}/players`, label: 'Players' },
        { href: `/league/${leagueId}/trades`, label: 'Trades' },
    ];

    if (leagueStatus === 'setup' || leagueStatus === 'drafting') {
        links.push({ href: `/league/${leagueId}/draft`, label: 'Draft Channel' });
    }

    return (
        <nav className={styles.nav}>
            <div className={styles.inner}>
                {links.map((link) => {
                    const isActive = link.exact
                        ? pathname === link.href
                        : pathname?.startsWith(link.href);

                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={`${styles.link} ${isActive ? styles.linkActive : ''}`}
                        >
                            {link.label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
