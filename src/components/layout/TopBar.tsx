'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';
import { Icon } from '@/components/ui/Icon';
import CrestBadge from '@/components/crest/CrestBadge';
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
  abbreviation?: string | null;
  crest_config?: any;
  faab_budget?: number | null;
  league: LeagueInfo;
}

interface NavGroup {
  label: string;
  items: { label: string; href: string; disabled?: boolean }[];
}

/**
 * Which dropdown item is the current page.
 *
 * A plain `startsWith` breaks as soon as one item's href is a prefix of a
 * sibling's — the Transfers group has `/transfers` alongside
 * `/transfers/listings`, so Market would light up on all four pages. An item
 * that prefixes a sibling has to match exactly; everything else keeps prefix
 * matching so deeper routes still highlight their section.
 */
function isItemActive(
  pathname: string | null,
  href: string,
  siblings: { href: string }[],
): boolean {
  if (!pathname) return false;
  const prefixesASibling = siblings.some((s) => s.href !== href && s.href.startsWith(`${href}/`));
  return prefixesASibling ? pathname === href : pathname.startsWith(href);
}

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [isSiteAdmin, setIsSiteAdmin] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const userDropdownRef = useRef<HTMLDivElement>(null);
  const pageNavRef = useRef<HTMLDivElement>(null);
  const dropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Extract current leagueId from URL — exclude static segments like 'create', 'join'
  const RESERVED_SEGMENTS = new Set(['create', 'join']);
  const leagueIdMatch = pathname?.match(/\/league\/([^/]+)/);
  const rawLeagueId = leagueIdMatch ? leagueIdMatch[1] : null;
  const currentLeagueId = rawLeagueId && !RESERVED_SEGMENTS.has(rawLeagueId) ? rawLeagueId : null;

  // Find the current league's status for conditional nav items
  const currentTeam = teams.find(t => t.league.id === currentLeagueId);
  const currentLeague = currentTeam?.league;
  const currentCrestConfig = currentTeam?.crest_config;
  const initials = (username || 'Manager').trim().substring(0, 2).toUpperCase();

  // Clear loading bar when navigation completes (pathname changed)
  useEffect(() => {
    setIsNavigating(false);
    setOpenDropdown(null);
    setMobileMenuOpen(false);
    setUserDropdownOpen(false);
  }, [pathname]);

  // Listen for global navigation-start events fired by NavigationLink
  useEffect(() => {
    function handleNavStart() { setIsNavigating(true); }
    window.addEventListener('navigation-start', handleNavStart);
    return () => window.removeEventListener('navigation-start', handleNavStart);
  }, []);

  // Fetch user's teams + leagues via server API (bypasses RLS)
  useEffect(() => {
    fetch('/api/user/leagues')
      .then(r => r.json())
      .then(({ teams: data }) => {
        if (data) setTeams(data);
      });

    // Platform admin status — distinct from any league's commissioner
    fetch('/api/user/admin-status')
      .then(r => r.json())
      .then(({ isSiteAdmin: admin }) => setIsSiteAdmin(!!admin));

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

  // Close switcher or dropdowns on outside click & Escape key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
      if (pageNavRef.current && !pageNavRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenDropdown(null);
        setUserDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
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
          // The hub's own sub-nav is the primary way around these four; this
          // group exists so the section is reachable from anywhere in the app.
          { label: 'Market', href: `${base}/transfers` },
          { label: 'Auctions', href: `${base}/transfers/auctions` },
          { label: 'Listings', href: `${base}/transfers/listings` },
          { label: 'Free Agency', href: `${base}/transfers/free-agents` },
          { label: 'Deals', href: `${base}/transfers/deals` },
        ],
      },
      {
        label: 'Fixtures',
        items: [
          { label: 'Gameweeks', href: `${base}/matchups` },
          { label: 'Cups', href: `${base}/tournaments` },
        ],
      },
    ];

    return groups;
  }

  // Check if a nav group is active
  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(item => !item.disabled && pathname?.startsWith(item.href));
  }

  // Check if Home is active (exact match). During setup/drafting the league
  // home IS the draft lobby, so Draft owns that highlight instead.
  function isHomeActive(): boolean {
    if (!currentLeagueId) return false;
    if (currentLeague?.status === 'setup' || currentLeague?.status === 'drafting') return false;
    return pathname === `/league/${currentLeagueId}`;
  }

  // Check if Activity is active
  function isActivityActive(): boolean {
    if (!currentLeagueId) return false;
    return pathname?.startsWith(`/league/${currentLeagueId}/activity`) ?? false;
  }

  // Draft is its own top-level item during setup/drafting; lobby lives on the
  // league home page (PreDraftLobby), with the live room under /draft.
  const isDraftVisible = currentLeague?.status === 'setup' || currentLeague?.status === 'drafting';
  function isDraftActive(): boolean {
    if (!currentLeagueId || !isDraftVisible) return false;
    const base = `/league/${currentLeagueId}`;
    return pathname === base || (pathname?.startsWith(`${base}/draft`) ?? false);
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
          <span className={styles.brandIcon}><Icon name="gaffa" size={20} strokeWidth={2} /></span>
          <span className={styles.brandName}>Gaffa</span>
        </Link>

        {/* --- Page Navigation (only when in a league) --- */}
        {currentLeagueId && (
          <div className={styles.pageNav} ref={pageNavRef}>
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
                  onClick={() => {
                    setOpenDropdown(prev => prev === group.label ? null : group.label);
                  }}
                  aria-expanded={openDropdown === group.label}
                  aria-haspopup="true"
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
                          className={`${styles.dropdownLink} ${isItemActive(pathname, item.href, group.items) ? styles.dropdownLinkActive : ''}`}
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

            {/* Draft (standalone — setup/drafting only; opens the lobby) */}
            {isDraftVisible && (
              <div className={styles.navItem}>
                <Link
                  href={`/league/${currentLeagueId}`}
                  className={`${styles.navLink} ${isDraftActive() ? styles.navLinkActive : ''}`}
                  onClick={() => setIsNavigating(true)}
                >
                  Draft
                </Link>
              </div>
            )}
          </div>
        )}

        {/* --- Right Section --- */}
        <div className={styles.rightSection}>
          {/* Club Balance */}
          {currentLeagueId && currentTeam && (
            <Link
              href={`/league/${currentLeagueId}/finance`}
              className={styles.balancePill}
              title="Club Balance"
              onClick={() => setIsNavigating(true)}
            >
              <span className={styles.balancePillAmount}>€{currentTeam.faab_budget ?? 0}m</span>
            </Link>
          )}

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

          {/* Platform Admin — site admin only, not scoped to any one league */}
          {isSiteAdmin && (
            <Link
              href="/admin/offseason"
              className={`${styles.iconBtn} ${pathname?.startsWith('/admin/offseason') ? styles.iconBtnActive : ''}`}
              title="Platform Admin"
              aria-label="Platform Admin"
              onClick={() => setIsNavigating(true)}
            >
              <Icon name="settings" size={18} strokeWidth={1.5} />
            </Link>
          )}

          {/* Notification Bell */}
          <NotificationBell
            leagueId={currentLeagueId}
            onNavigate={() => setIsNavigating(true)}
          />

          {/* Theme Toggle (Desktop Desktop) */}
          <div className={styles.desktopThemeToggle}>
            <ThemeToggle />
          </div>

          {/* Consolidated User Profile Dropdown */}
          <div className={styles.userDropdownContainer} ref={userDropdownRef}>
            <button
              className={styles.avatarBtn}
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              type="button"
              aria-label="User menu"
              aria-expanded={userDropdownOpen}
              aria-haspopup="true"
            >
              {currentLeagueId && currentCrestConfig ? (
                <CrestBadge
                  config={currentCrestConfig}
                  size={32}
                  teamName={currentTeam?.team_name || username}
                />
              ) : (
                <div className={styles.userInitialsAvatar} style={{ width: '32px', height: '32px', fontSize: '11px' }}>
                  {initials}
                </div>
              )}
            </button>

            {userDropdownOpen && (
              <div className={styles.userDropdown}>
                {/* Header Profile Identity */}
                <div className={styles.dropdownHeader}>
                  <div style={{ marginRight: '12px', flexShrink: 0 }}>
                    {currentLeagueId && currentCrestConfig ? (
                      <CrestBadge
                        config={currentCrestConfig}
                        size={40}
                        teamName={currentTeam?.team_name || username}
                      />
                    ) : (
                      <div className={styles.userInitialsAvatar} style={{ width: '40px', height: '40px', fontSize: '13px' }}>
                        {initials}
                      </div>
                    )}
                  </div>
                  <div className={styles.dropdownHeaderDetails}>
                    <div className={styles.dropdownClubName}>
                      {currentTeam?.team_name || 'My Club'}
                    </div>
                    <div className={styles.dropdownUsername}>
                      @{username || 'manager'}
                    </div>
                    {currentLeagueId && (
                      <Link
                        href={`/league/${currentLeagueId}/crest`}
                        className={styles.editCrestLink}
                        onClick={() => setUserDropdownOpen(false)}
                      >
                        Edit Crest →
                      </Link>
                    )}
                  </div>
                </div>

                <div className={styles.dropdownDivider} />

                {/* League Switcher Section */}
                <div className={styles.dropdownSection}>
                  <div className={styles.dropdownSectionLabel}>Switch League</div>
                  {teams.length > 0 ? (
                    <div className={styles.leagueList}>
                      {teams.map((team) => (
                        <Link
                          key={team.league.id}
                          href={`/league/${team.league.id}`}
                          className={`${styles.dropdownItem} ${team.league.id === currentLeagueId ? styles.dropdownItemActive : ''}`}
                          onClick={() => {
                            setUserDropdownOpen(false);
                            setIsNavigating(true);
                          }}
                        >
                          <span
                            className={`${styles.leagueDot} ${team.league.id === currentLeagueId ? styles.leagueDotActive : styles.leagueDotInactive}`}
                          />
                          <span className={styles.dropdownItemName}>{team.league.name}</span>
                          <span className={styles.dropdownItemSeason}>{team.league.season}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '8px 16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                      No leagues yet
                    </div>
                  )}

                  <div className={styles.dropdownDivider} style={{ margin: '8px 0' }} />

                  <Link
                    href="/league/create"
                    className={styles.dropdownActionLink}
                    onClick={() => { setUserDropdownOpen(false); setIsNavigating(true); }}
                  >
                    + Create League
                  </Link>
                  <Link
                    href="/league/join"
                    className={styles.dropdownActionLink}
                    onClick={() => { setUserDropdownOpen(false); setIsNavigating(true); }}
                  >
                    ↳ Join League
                  </Link>
                </div>

                <div className={styles.dropdownDivider} />

                {/* Mobile settings / Sign out */}
                <div style={{ padding: '4px 0' }}>
                  <button onClick={handleSignOut} className={styles.dropdownSignOutBtn} type="button">
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

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

            {/* Draft (standalone — setup/drafting only; opens the lobby) */}
            {isDraftVisible && (
              <div className={styles.mobileDrawerItem}>
                <Link
                  href={`/league/${currentLeagueId}`}
                  className={`${styles.mobileDrawerLink} ${isDraftActive() ? styles.mobileDrawerLinkActive : ''}`}
                  onClick={() => {
                    setIsNavigating(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  Draft
                </Link>
              </div>
            )}

            {/* Mobile User Section */}
            <div className={styles.mobileDrawerUserSection}>
              <div className={styles.mobileDrawerUserDetail}>
                <div className={styles.mobileDrawerCrest}>
                  <CrestBadge
                    config={currentCrestConfig}
                    size={36}
                    teamName={currentTeam?.team_name || username}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span className={styles.mobileDrawerUsername}>{currentTeam?.team_name || 'My Club'}</span>
                  {currentTeam && (
                    <Link
                      href={`/league/${currentLeagueId}/finance`}
                      className={styles.mobileBalanceLink}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Club Balance: €{currentTeam.faab_budget ?? 0}m
                    </Link>
                  )}
                  {currentLeagueId && (
                    <Link
                      href={`/league/${currentLeagueId}/crest`}
                      className={styles.mobileEditCrestLink}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Edit Crest →
                    </Link>
                  )}
                </div>
                <div className={styles.mobileDrawerThemeToggle}>
                  <ThemeToggle />
                </div>
              </div>
              <div className={styles.mobileDrawerUserDivider} />
              <button onClick={handleSignOut} className={styles.mobileDrawerSignOut} type="button">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
