'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';
import { Icon } from '@/components/ui/Icon';
import styles from './TopBar.module.css';

interface LeagueInfo {
  id: string;
  name: string;
  status: string;
  season: string;
}

interface UserTeam {
  id: string;
  team_name: string;
  league: LeagueInfo;
}

interface NavGroup {
  label: string;
  items: { label: string; href: string; disabled?: boolean }[];
}

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [leagueSwitcherOpen, setLeagueSwitcherOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const leagueSwitcherRef = useRef<HTMLDivElement>(null);
  const dropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Extract current leagueId from URL — exclude static segments like 'create', 'join'
  const RESERVED_SEGMENTS = new Set(['create', 'join']);
  const leagueIdMatch = pathname?.match(/\/league\/([^/]+)/);
  const rawLeagueId = leagueIdMatch ? leagueIdMatch[1] : null;
  const currentLeagueId = rawLeagueId && !RESERVED_SEGMENTS.has(rawLeagueId) ? rawLeagueId : null;

  // Find the current league's status for conditional nav items
  const currentTeam = teams.find(t => t.league.id === currentLeagueId);
  const currentLeague = currentTeam?.league;

  // Clear loading bar when navigation completes (pathname changed)
  useEffect(() => {
    setIsNavigating(false);
    setOpenDropdown(null);
    setMobileMenuOpen(false);
  }, [pathname]);

  // Fetch user's teams + leagues via server API (bypasses RLS)
  useEffect(() => {
    fetch('/api/user/leagues')
      .then(r => r.json())
      .then(({ teams: data }) => {
        if (data) setTeams(data);
      });

    // Also fetch username
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .single()
        .then(({ data }) => { if (data) setUsername(data.username); });
    });
  }, []);

  // Close league switcher on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (leagueSwitcherRef.current && !leagueSwitcherRef.current.contains(e.target as Node)) {
        setLeagueSwitcherOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    setIsNavigating(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // Build page nav groups (only shown when inside a league)
  function getNavGroups(): NavGroup[] {
    if (!currentLeagueId) return [];
    const base = `/league/${currentLeagueId}`;
    const isDraftVisible = currentLeague?.status === 'setup' || currentLeague?.status === 'drafting';

    const groups: NavGroup[] = [
      {
        label: 'Squad',
        items: [
          { label: 'Lineup', href: `${base}/team` },
          { label: 'My Club', href: `${base}/team/roster` },
        ],
      },
      {
        label: 'League',
        items: [
          { label: 'Standings', href: `${base}/standings` },
          { label: 'Stats', href: `${base}/stats` },
          { label: 'Finance', href: `${base}/finance` },
          { label: 'History', href: `${base}/history` },
        ],
      },
      {
        label: 'Transfers',
        items: [
          { label: 'Free Agency', href: `${base}/players` },
          { label: 'Trades', href: `${base}/trades` },
        ],
      },
      {
        label: 'Competitions',
        items: [
          { label: 'Fixtures', href: `${base}/matchups` },
          { label: 'Cups', href: `${base}/tournaments` },
          ...(isDraftVisible ? [{ label: 'Draft', href: `${base}/draft` }] : []),
        ],
      },
    ];

    return groups;
  }

  // Check if a nav group is active
  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(item => !item.disabled && pathname?.startsWith(item.href));
  }

  // Check if Home is active (exact match)
  function isHomeActive(): boolean {
    if (!currentLeagueId) return false;
    return pathname === `/league/${currentLeagueId}`;
  }

  // Check if Activity is active
  function isActivityActive(): boolean {
    if (!currentLeagueId) return false;
    return pathname?.startsWith(`/league/${currentLeagueId}/activity`) ?? false;
  }

  // Dropdown hover handlers with debounce
  const handleDropdownEnter = useCallback((label: string) => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current);
      dropdownTimeoutRef.current = null;
    }
    setOpenDropdown(label);
  }, []);

  const handleDropdownLeave = useCallback(() => {
    dropdownTimeoutRef.current = setTimeout(() => {
      setOpenDropdown(null);
    }, 150);
  }, []);

  const navGroups = getNavGroups();

  return (
    <nav className={styles.topBar}>
      {isNavigating && <div className={styles.loadingBar} />}
      <div className={styles.inner}>
        {/* --- Wordmark --- */}
        <Link href="/dashboard" className={styles.brand} onClick={() => setIsNavigating(true)}>
          <span className={styles.brandIcon}><Icon name="activity" size={20} strokeWidth={2} /></span>
          <span className={styles.brandName}>Gaffa</span>
        </Link>

        {/* --- Page Navigation (only when in a league) --- */}
        {currentLeagueId && (
          <div className={styles.pageNav}>
            {/* Home (standalone) */}
            <div className={styles.navItem}>
              <Link
                href={`/league/${currentLeagueId}`}
                className={`${styles.navLink} ${isHomeActive() ? styles.navLinkActive : ''}`}
                onClick={() => setIsNavigating(true)}
              >
                Home
              </Link>
            </div>

            {/* Grouped nav items with dropdowns */}
            {navGroups.map((group) => (
              <div
                key={group.label}
                className={styles.navItem}
                onMouseEnter={() => handleDropdownEnter(group.label)}
                onMouseLeave={handleDropdownLeave}
              >
                <button
                  className={`${styles.navLink} ${isGroupActive(group) ? styles.navLinkActive : ''}`}
                  type="button"
                >
                  {group.label}
                  <span className={`${styles.chevron} ${openDropdown === group.label ? styles.chevronOpen : ''}`}>
                    ▾
                  </span>
                </button>

                {openDropdown === group.label && (
                  <div className={styles.dropdown}>
                    {group.items.map((item) => (
                      item.disabled ? (
                        <span
                          key={item.label}
                          className={`${styles.dropdownLink} ${styles.dropdownLinkDisabled}`}
                        >
                          {item.label}
                          <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.6 }}>Soon</span>
                        </span>
                      ) : (
                        <Link
                          key={item.label}
                          href={item.href}
                          className={`${styles.dropdownLink} ${pathname?.startsWith(item.href) ? styles.dropdownLinkActive : ''}`}
                          onClick={() => {
                            setIsNavigating(true);
                            setOpenDropdown(null);
                          }}
                        >
                          {item.label}
                        </Link>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Activity (standalone) */}
            <div className={styles.navItem}>
              <Link
                href={`/league/${currentLeagueId}/activity`}
                className={`${styles.navLink} ${isActivityActive() ? styles.navLinkActive : ''}`}
                onClick={() => setIsNavigating(true)}
              >
                Activity
              </Link>
            </div>
          </div>
        )}

        {/* --- Right Section --- */}
        <div className={styles.rightSection}>
          {/* League Switcher */}
          <div className={styles.leagueSwitcher} ref={leagueSwitcherRef}>
            <button
              className={styles.leagueSwitcherBtn}
              onClick={() => setLeagueSwitcherOpen(!leagueSwitcherOpen)}
              type="button"
            >
              <div>
                <div className={styles.leagueLabel}>League</div>
                <div className={styles.leagueName}>
                  {currentLeague ? currentLeague.name : 'Select League'}
                </div>
              </div>
              <span className={`${styles.leagueSwitcherChevron} ${leagueSwitcherOpen ? styles.leagueSwitcherChevronOpen : ''}`}>
                ▾
              </span>
            </button>

            {leagueSwitcherOpen && (
              <div className={styles.leagueDropdown}>
                {teams.length > 0 ? (
                  <>
                    {teams.map((team) => (
                      <Link
                        key={team.league.id}
                        href={`/league/${team.league.id}`}
                        className={`${styles.leagueDropdownItem} ${team.league.id === currentLeagueId ? styles.leagueDropdownItemActive : ''}`}
                        onClick={() => { setLeagueSwitcherOpen(false); setIsNavigating(true); }}
                      >
                        <span
                          className={`${styles.leagueDot} ${team.league.id === currentLeagueId ? styles.leagueDotActive : styles.leagueDotInactive}`}
                        />
                        <span className={styles.leagueDropdownName}>{team.league.name}</span>
                        <span className={styles.leagueDropdownSeason}>{team.league.season}</span>
                      </Link>
                    ))}
                    <div className={styles.leagueDropdownDivider} />
                  </>
                ) : (
                  <div style={{ padding: '8px 16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                    No leagues yet
                  </div>
                )}
                <Link
                  href="/league/create"
                  className={styles.leagueDropdownAction}
                  onClick={() => { setLeagueSwitcherOpen(false); setIsNavigating(true); }}
                >
                  + Create League
                </Link>
                <Link
                  href="/league/join"
                  className={styles.leagueDropdownAction}
                  onClick={() => { setLeagueSwitcherOpen(false); setIsNavigating(true); }}
                >
                  ↳ Join League
                </Link>
              </div>
            )}
          </div>

          {/* Persistent League Chat */}
          {currentLeagueId && (
            <Link
              href={`/league/${currentLeagueId}/chat`}
              className={`${styles.iconBtn} ${pathname?.startsWith(`/league/${currentLeagueId}/chat`) ? styles.iconBtnActive : ''}`}
              title="League Chat Lobby"
              aria-label="League Chat Lobby"
              onClick={() => setIsNavigating(true)}
            >
              <Icon name="message-square" size={18} strokeWidth={1.5} />
            </Link>
          )}

          {/* Notification Bell */}
          <NotificationBell leagueId={currentLeagueId} />

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* User Avatar */}
          <div className={styles.userAvatar}>
            {username ? username[0].toUpperCase() : '?'}
          </div>

          {/* Sign Out */}
          <button onClick={handleSignOut} className={styles.signOut} type="button">
            Sign out
          </button>

          {/* Hamburger Menu Toggle (Mobile Only) */}
          {currentLeagueId && (
            <button
              className={styles.menuToggle}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <Icon name="x" size={20} strokeWidth={2} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* --- Mobile Drawer Navigation (Mobile Only) --- */}
      {currentLeagueId && mobileMenuOpen && (
        <div className={styles.mobileDrawer}>
          <div className={styles.mobileDrawerContent}>
            {/* Home (standalone) */}
            <div className={styles.mobileDrawerItem}>
              <Link
                href={`/league/${currentLeagueId}`}
                className={`${styles.mobileDrawerLink} ${isHomeActive() ? styles.mobileDrawerLinkActive : ''}`}
                onClick={() => {
                  setIsNavigating(true);
                  setMobileMenuOpen(false);
                }}
              >
                Home
              </Link>
            </div>

            {/* Nav Groups */}
            {navGroups.map((group) => (
              <div key={group.label} className={styles.mobileDrawerGroup}>
                <div className={styles.mobileDrawerGroupLabel}>{group.label}</div>
                <div className={styles.mobileDrawerGroupItems}>
                  {group.items.map((item) => (
                    item.disabled ? (
                      <span
                        key={item.label}
                        className={`${styles.mobileDrawerSubLink} ${styles.mobileDrawerSubLinkDisabled}`}
                      >
                        {item.label}
                        <span style={{ fontSize: '9px', marginLeft: '6px', opacity: 0.5 }}>Soon</span>
                      </span>
                    ) : (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`${styles.mobileDrawerSubLink} ${pathname?.startsWith(item.href) ? styles.mobileDrawerSubLinkActive : ''}`}
                        onClick={() => {
                          setIsNavigating(true);
                          setMobileMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </Link>
                    )
                  ))}
                </div>
              </div>
            ))}

            {/* Activity (standalone) */}
            <div className={styles.mobileDrawerItem}>
              <Link
                href={`/league/${currentLeagueId}/activity`}
                className={`${styles.mobileDrawerLink} ${isActivityActive() ? styles.mobileDrawerLinkActive : ''}`}
                onClick={() => {
                  setIsNavigating(true);
                  setMobileMenuOpen(false);
                }}
              >
                Activity
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
