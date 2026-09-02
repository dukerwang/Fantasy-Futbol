'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';
import ChatNavIcon from './ChatNavIcon';
import { Icon } from '@/components/ui/Icon';
import CrestBadge from '@/components/crest/CrestBadge';
import { clubHref } from '@/lib/teams/clubHref';
import styles from './TopBar.module.css';

interface LeagueInfo {
  id: string;
  name: string;
  status: string;
  season: string;
}

interface LeagueTeamBalance {
  id: string;
  team_name: string;
  faab_budget: number | null;
  crest_config?: any;
}

interface UserTeam {
  id: string;
  team_name: string;
  abbreviation?: string | null;
  crest_config?: any;
  faab_budget?: number | null;
  league: LeagueInfo;
}

interface NavItem {
  label: string;
  href: string;
  disabled?: boolean;
  /**
   * Extra route prefixes this item owns. Clubs lives at `/team/roster` but the
   * same page serves every rival at `/clubs/<id>`; without this the top bar
   * goes completely dark the moment you open someone else's squad.
   */
  alsoMatches?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
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
  alsoMatches?: string[],
): boolean {
  if (!pathname) return false;
  if (alsoMatches?.some((p) => pathname.startsWith(p))) return true;
  const prefixesASibling = siblings.some((s) => s.href !== href && s.href.startsWith(`${href}/`));
  return prefixesASibling ? pathname === href : pathname.startsWith(href);
}

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [balanceDropdownOpen, setBalanceDropdownOpen] = useState(false);
  const [leagueBalances, setLeagueBalances] = useState<LeagueTeamBalance[]>([]);
  const [leagueBalancesLoading, setLeagueBalancesLoading] = useState(false);

  const userDropdownRef = useRef<HTMLDivElement>(null);
  const pageNavRef = useRef<HTMLDivElement>(null);
  const balanceDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const balanceDropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const navTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    setBalanceDropdownOpen(false);
    if (navTimeoutRef.current) {
      clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = null;
    }
  }, [pathname]);

  // Listen for global navigation-start events fired by NavigationLink. A push to the
  // page you're already on never changes `pathname`, so the effect above never fires —
  // this timeout is a safety net so the loading bar can't get stuck forever in that case.
  useEffect(() => {
    function handleNavStart() {
      setIsNavigating(true);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
      navTimeoutRef.current = setTimeout(() => setIsNavigating(false), 4000);
    }
    window.addEventListener('navigation-start', handleNavStart);
    return () => {
      window.removeEventListener('navigation-start', handleNavStart);
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  // Fetch user's teams + leagues on mount, tab visibility, or via Supabase Realtime.
  // Realtime updates the Club Balance and crest directly over WebSockets (0 Vercel
  // function invocations) whenever a trade, bid, or budget update commits to Postgres.
  const fetchTeams = useCallback(() => {
    fetch('/api/user/leagues')
      .then((r) => r.json())
      .then(({ teams: data }) => {
        if (data) setTeams(data);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchTeams();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchTeams();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      channel = supabase
        .channel(`user-teams-topbar:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'teams',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const updated = payload.new as { id: string; faab_budget?: number; team_name?: string; crest_config?: any };
            setTeams((prev) =>
              prev.map((t) =>
                t.id === updated.id
                  ? {
                      ...t,
                      team_name: updated.team_name ?? t.team_name,
                      faab_budget: updated.faab_budget !== undefined ? updated.faab_budget : t.faab_budget,
                      crest_config: updated.crest_config ?? t.crest_config,
                    }
                  : t
              )
            );
          }
        )
        .subscribe();
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchTeams]);

  // Username doesn't change mid-session, so this stays mount-only.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(true);
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
      if (balanceDropdownRef.current && !balanceDropdownRef.current.contains(e.target as Node)) {
        setBalanceDropdownOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenDropdown(null);
        setUserDropdownOpen(false);
        setBalanceDropdownOpen(false);
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
          // "Clubs", not "My Club": the destination is still your own squad,
          // but the page it opens is the way into every squad in the league,
          // and the item has to stay lit while you're reading a rival's.
          { label: 'Clubs', href: `${base}/team/roster`, alsoMatches: [`${base}/clubs/`] },
        ],
      },
      {
        label: 'League',
        items: [
          { label: 'Standings', href: `${base}/standings` },
          // Named for its contents rather than a vague umbrella. It stays lit
          // on a player's own page, which is reached from here and from the
          // card modal on a dozen other surfaces.
          { label: 'Players', href: `${base}/players`, alsoMatches: [`${base}/players/`] },
          { label: 'Stats', href: `${base}/stats` },
          { label: 'Finance', href: `${base}/finance` },
          { label: 'History', href: `${base}/history` },
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

  // Check if a nav group is active. Deliberately looser than isItemActive —
  // a group lights up for anything beneath any of its items — but it has to
  // honour `alsoMatches` too, or Squad would go dark on a rival's club page.
  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(
      (item) =>
        !item.disabled &&
        (pathname?.startsWith(item.href) ||
          item.alsoMatches?.some((p) => pathname?.startsWith(p))),
    );
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

  // Transfers is a standalone link, not a dropdown — Market is the hub for
  // Auctions/Listings/Free Agency/Deals, so the top bar only needs one door in.
  function isTransfersActive(): boolean {
    if (!currentLeagueId) return false;
    return pathname?.startsWith(`/league/${currentLeagueId}/transfers`) ?? false;
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

  // Club Balance dropdown: every club's balance, fetched fresh each time it
  // opens rather than cached — this figure changes the moment a bid resolves
  // or a trade completes, and nothing else in the topbar polls for it.
  const handleBalanceEnter = useCallback(() => {
    if (balanceDropdownTimeoutRef.current) {
      clearTimeout(balanceDropdownTimeoutRef.current);
      balanceDropdownTimeoutRef.current = null;
    }
    setBalanceDropdownOpen(true);
  }, []);

  const handleBalanceLeave = useCallback(() => {
    balanceDropdownTimeoutRef.current = setTimeout(() => {
      setBalanceDropdownOpen(false);
    }, 150);
  }, []);

  useEffect(() => {
    if (!balanceDropdownOpen || !currentLeagueId) return;
    setLeagueBalancesLoading(true);
    fetch(`/api/leagues/${currentLeagueId}/teams`)
      .then(r => r.json())
      .then(({ teams: data }) => {
        if (data) setLeagueBalances(data);
      })
      .finally(() => setLeagueBalancesLoading(false));
  }, [balanceDropdownOpen, currentLeagueId]);

  const navGroups = getNavGroups();

  return (
    <nav className={styles.topBar}>
      {isNavigating && <div className={styles.loadingBar} />}
      <div className={styles.inner}>
        {/* --- Wordmark --- */}
        <Link href={isAuthenticated ? '/dashboard' : '/login'} className={styles.brand} onClick={() => setIsNavigating(true)}>
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
                          className={`${styles.dropdownLink} ${isItemActive(pathname, item.href, group.items, item.alsoMatches) ? styles.dropdownLinkActive : ''}`}
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

            {/* Transfers (standalone — Market is the hub for the other four pages) */}
            <div className={styles.navItem}>
              <Link
                href={`/league/${currentLeagueId}/transfers`}
                className={`${styles.navLink} ${isTransfersActive() ? styles.navLinkActive : ''}`}
                onClick={() => setIsNavigating(true)}
              >
                Transfers
              </Link>
            </div>

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
            <div
              className={styles.balanceContainer}
              ref={balanceDropdownRef}
              onMouseEnter={handleBalanceEnter}
              onMouseLeave={handleBalanceLeave}
            >
              <button
                type="button"
                className={styles.balancePill}
                title="Club Balance"
                onClick={() => setBalanceDropdownOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={balanceDropdownOpen}
              >
                <span className={styles.balancePillLabel}>Club Balance</span>
                <span className={styles.balancePillAmount}>€{currentTeam.faab_budget ?? 0}m</span>
                <span className={`${styles.chevron} ${balanceDropdownOpen ? styles.chevronOpen : ''}`}>▾</span>
              </button>

              {balanceDropdownOpen && (
                <div className={styles.balanceDropdown}>
                  <div className={styles.dropdownSectionLabel}>Club Balances</div>
                  {leagueBalancesLoading && leagueBalances.length === 0 ? (
                    <div className={styles.balanceDropdownEmpty}>Loading…</div>
                  ) : (
                    <div className={styles.balanceList}>
                      {leagueBalances.map((team) => {
                        const isCurrent = team.id === currentTeam.id;
                        return (
                          <Link
                            key={team.id}
                            href={clubHref(currentLeagueId, team.id, isCurrent)}
                            className={`${styles.balanceRow} ${isCurrent ? styles.balanceRowActive : ''}`}
                            onClick={() => {
                              setBalanceDropdownOpen(false);
                              setIsNavigating(true);
                            }}
                          >
                            <CrestBadge
                              config={team.crest_config}
                              teamName={team.team_name}
                              size={20}
                              interactive={false}
                            />
                            <span className={styles.balanceRowName}>{team.team_name}</span>
                            <span className={styles.balanceRowAmount}>€{team.faab_budget ?? 0}m</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                  <div className={styles.dropdownDivider} />
                  <Link
                    href={`/league/${currentLeagueId}/finance`}
                    className={styles.dropdownActionLink}
                    onClick={() => {
                      setBalanceDropdownOpen(false);
                      setIsNavigating(true);
                    }}
                  >
                    View Finance →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Persistent League Chat */}
          {currentLeagueId && (
            <ChatNavIcon
              leagueId={currentLeagueId}
              onNavigate={() => setIsNavigating(true)}
            />
          )}

          {/* Theme Toggle (Desktop Desktop) */}
          <div className={styles.desktopThemeToggle}>
            <ThemeToggle />
          </div>

          {isAuthenticated === false ? (
            <Link
              href="/login"
              className={styles.signInBtn}
              onClick={() => setIsNavigating(true)}
            >
              Sign In
            </Link>
          ) : (
            <>
              {/* Notification Bell */}
              <NotificationBell
                leagueId={currentLeagueId}
                onNavigate={() => setIsNavigating(true)}
              />

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
                            teamId={currentTeam?.id}
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

                    <Link
                      href={currentLeagueId ? `/league/${currentLeagueId}/settings` : '/settings'}
                      className={styles.dropdownActionLink}
                      onClick={() => { setUserDropdownOpen(false); setIsNavigating(true); }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <Icon name="settings" size={14} strokeWidth={1.75} />
                        Settings
                      </span>
                    </Link>

                    <Link
                      href={currentLeagueId ? `/league/${currentLeagueId}/help` : '/help'}
                      className={styles.dropdownActionLink}
                      onClick={() => { setUserDropdownOpen(false); setIsNavigating(true); }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <Icon name="help-circle" size={14} strokeWidth={1.75} />
                        Help
                      </span>
                    </Link>

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
            </>
          )}

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
            {/* Primary Hub Links */}
            <div className={styles.mobileDrawerGroup}>
              <div className={styles.mobileDrawerGroupLabel}>Overview</div>
              <div className={styles.mobileDrawerGroupItems}>
                <Link
                  href={`/league/${currentLeagueId}`}
                  className={`${styles.mobileDrawerSubLink} ${isHomeActive() ? styles.mobileDrawerSubLinkActive : ''}`}
                  onClick={() => {
                    setIsNavigating(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  Home
                </Link>
                <Link
                  href={`/league/${currentLeagueId}/transfers`}
                  className={`${styles.mobileDrawerSubLink} ${isTransfersActive() ? styles.mobileDrawerSubLinkActive : ''}`}
                  onClick={() => {
                    setIsNavigating(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  Transfers
                </Link>
                <Link
                  href={`/league/${currentLeagueId}/activity`}
                  className={`${styles.mobileDrawerSubLink} ${isActivityActive() ? styles.mobileDrawerSubLinkActive : ''}`}
                  onClick={() => {
                    setIsNavigating(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  Activity
                </Link>
                {isDraftVisible && (
                  <Link
                    href={`/league/${currentLeagueId}`}
                    className={`${styles.mobileDrawerSubLink} ${isDraftActive() ? styles.mobileDrawerSubLinkActive : ''}`}
                    onClick={() => {
                      setIsNavigating(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Draft
                  </Link>
                )}
              </div>
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
          </div>
        </div>
      )}
    </nav>
  );
}
