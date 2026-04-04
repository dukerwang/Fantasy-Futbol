'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './AppShell.module.css';

interface Props {
  leagueId: string;
  leagueStatus: string;
  children: React.ReactNode;
}

const IconLeague = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M9 2L3 4.5V9c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4.5L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const IconTeam = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="5" r="3" fill="currentColor" />
    <path d="M2 16c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconMatchups = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1" y="4" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <rect x="11" y="4" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconPlayers = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="6" cy="6" r="2.5" fill="currentColor" />
    <circle cx="12" cy="6" r="2.5" fill="currentColor" fillOpacity="0.5" />
    <path d="M1 15c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 10c1.5 0 5 .672 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconStats = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 13L6 8L10 10L14 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="14" cy="4" r="1.5" fill="currentColor" />
  </svg>
);

const IconCups = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M5 2h8l-1 6a4 4 0 01-6 0L5 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M5 2H3l.5 3a2.5 2.5 0 002 2M13 2h2l-.5 3a2.5 2.5 0 01-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9 14v3M6 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconTrades = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M3 6h12M3 6l3-3M3 6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 12H3M15 12l-3-3M15 12l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconActivity = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 5v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconStandings = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="11" width="4" height="5" rx="1" fill="currentColor" />
    <rect x="7" y="7" width="4" height="9" rx="1" fill="currentColor" />
    <rect x="12" y="3" width="4" height="13" rx="1" fill="currentColor" />
  </svg>
);

const IconDraft = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export default function AppShell({ leagueId, leagueStatus, children }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === 'true') setCollapsed(true);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('teams')
        .select('name')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data) setTeamName(data.name);
        });
    });
  }, [leagueId]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  }

  const links = [
    { href: `/league/${leagueId}`, label: 'League', icon: <IconLeague />, exact: true },
    { href: `/league/${leagueId}/team`, label: 'My Team', icon: <IconTeam /> },
    { href: `/league/${leagueId}/standings`, label: 'Standings', icon: <IconStandings /> },
    { href: `/league/${leagueId}/matchups`, label: 'Matchups', icon: <IconMatchups /> },
    { href: `/league/${leagueId}/players`, label: 'Free Agency', icon: <IconPlayers /> },
    { href: `/league/${leagueId}/stats`, label: 'Stats', icon: <IconStats /> },
    { href: `/league/${leagueId}/tournaments`, label: 'Cups', icon: <IconCups /> },
    { href: `/league/${leagueId}/trades`, label: 'Trades', icon: <IconTrades /> },
    { href: `/league/${leagueId}/activity`, label: 'Activity', icon: <IconActivity /> },
  ];

  if (leagueStatus === 'setup' || leagueStatus === 'drafting') {
    links.push({ href: `/league/${leagueId}/draft`, label: 'Draft Channel', icon: <IconDraft />, exact: false });
  }

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
        <div className={styles.sidebarTop}>
          <div className={styles.teamSection}>
            <div className={styles.teamAvatar}>
              {teamName ? teamName[0].toUpperCase() : '?'}
            </div>
            {!collapsed && (
              <span className={styles.teamName}>{teamName ?? 'My Team'}</span>
            )}
          </div>
          <button
            onClick={toggle}
            className={styles.collapseBtn}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className={styles.nav}>
          {links.map((link) => {
            const isActive = link.exact
              ? pathname === link.href
              : pathname?.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                title={collapsed ? link.label : undefined}
              >
                <span className={styles.navIcon}>{link.icon}</span>
                {!collapsed && <span className={styles.navLabel}>{link.label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
