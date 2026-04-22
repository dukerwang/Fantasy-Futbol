import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { formatPlayerName } from '@/lib/formatName';
import styles from './league.module.css';
import DraftOrderManager from './DraftOrderManager';
import LeaveLeagueButton from './LeaveLeagueButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function positionColor(pos: string): string {
  const map: Record<string, string> = {
    GK: 'var(--color-pos-gk)',
    CB: 'var(--color-pos-cb)', LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
    DM: 'var(--color-pos-dm)',
    CM: 'var(--color-pos-cm)', LM: 'var(--color-pos-wm)', RM: 'var(--color-pos-wm)',
    AM: 'var(--color-pos-am)',
    LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)',
    ST: 'var(--color-pos-st)',
  };
  return map[pos] ?? 'var(--color-text-muted)';
}

function pointsBadgeColor(pts: number): string {
  if (pts >= 16) return 'var(--color-accent-green)';
  if (pts >= 10) return '#5a8a6a';
  if (pts >= 6) return 'var(--color-accent-yellow)';
  return 'var(--color-text-muted)';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

function txCategoryStyle(type: string): { label: string; color: string; bg: string } {
  switch (type) {
    case 'waiver_win':
    case 'faab_signing': return { label: 'SIGNING', color: '#fff', bg: 'var(--color-accent-green)' };
    case 'drop': return { label: 'DROP', color: '#fff', bg: 'var(--color-accent-red)' };
    case 'trade': return { label: 'TRADE', color: '#fff', bg: '#3b82f6' };
    case 'bid': return { label: 'BID', color: '#92400e', bg: '#fde68a' };
    case 'ir': return { label: 'IR', color: '#fff', bg: '#6b7280' };
    default: return { label: type.toUpperCase().replace(/_/g, ' '), color: '#fff', bg: 'var(--color-text-muted)' };
  }
}

function rankMedalStyle(rank: number): { bg: string; color: string } {
  if (rank === 1) return { bg: '#D4AF37', color: '#fff' };
  if (rank === 2) return { bg: '#A8A9AD', color: '#fff' };
  if (rank === 3) return { bg: '#CD7F32', color: '#fff' };
  return { bg: 'transparent', color: 'var(--color-text-muted)' };
}

// ── Page ─────────────────────────────────────────────────────────────────

export default async function LeaguePage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // ── My team ──────────────────────────────────────────────────────────────
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  const myTeamId = myTeam?.id ?? null;

  // ── Parallel data fetches ────────────────────────────────────────────────
  const [
    standingsResult,
    myMatchupsResult,
    auctionsResult,
    teamsResult,
    activityResult,
    taxiResult,
    tournamentsResult,
    recentMatchupsResult,
  ] = await Promise.all([
    // Full standings
    admin
      .from('league_standings')
      .select('team_id, team_name, rank, league_points, wins, draws, losses, played')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true }),

    // All matchups for user's team
    myTeamId ? admin
      .from('matchups')
      .select('*, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
      .eq('league_id', leagueId)
      .or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`)
      .order('gameweek', { ascending: true }) : Promise.resolve({ data: null }),

    // Live auctions
    admin
      .from('waiver_claims')
      .select(`
        id, team_id, faab_bid, expires_at,
        player:players!player_id(id, web_name, name, primary_position, pl_team, photo_url),
        team:teams(id, team_name)
      `)
      .eq('league_id', leagueId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .order('faab_bid', { ascending: false })
      .limit(4),

    // All teams
    admin
      .from('teams')
      .select('id, team_name, draft_order')
      .eq('league_id', leagueId),

    // Recent activity
    admin
      .from('transactions')
      .select(`
        id, type, faab_bid, notes, processed_at,
        team:teams(id, team_name),
        player:players(id, web_name, name, primary_position)
      `)
      .eq('league_id', leagueId)
      .order('processed_at', { ascending: false })
      .limit(5),

    // Taxi Squad
    myTeamId ? admin
      .from('roster_entries')
      .select('player:players(id, web_name, name, primary_position, pl_team, photo_url)')
      .eq('team_id', myTeamId)
      .eq('roster_status', 'taxi') : Promise.resolve({ data: [] }),

    // Tournaments
    admin
      .from('tournaments')
      .select('id, name, status, current_round')
      .eq('league_id', leagueId),

    // Recent matchups for form
    admin
      .from('matchups')
      .select('team_a_id, team_b_id, score_a, score_b, gameweek')
      .eq('league_id', leagueId)
      .eq('status', 'completed')
      .order('gameweek', { ascending: false })
      .limit(100)
  ]);

  const standings = standingsResult.data ?? [];
  const myMatchups = myMatchupsResult.data ?? [];
  const auctions = auctionsResult.data ?? [];
  const activity = activityResult.data ?? [];
  const initialTeams = (teamsResult.data ?? []) as Array<{ id: string; team_name: string; draft_order: number | null }>;
  const taxiSquad = taxiResult?.data ?? [];
  const tournaments = tournamentsResult?.data ?? [];
  const recentMatchups = recentMatchupsResult?.data ?? [];

  type FormResult = 'W' | 'D' | 'L';
  const DRAW_MARGIN = 10;
  function computeForm(teamId: string, matchups: any[]): FormResult[] {
    const results: FormResult[] = [];
    for (const m of matchups) {
      if (results.length >= 5) break;

      let myScore: number, theirScore: number;
      if (m.team_a_id === teamId) {
        myScore = m.score_a ?? 0;
        theirScore = m.score_b ?? 0;
      } else if (m.team_b_id === teamId) {
        myScore = m.score_b ?? 0;
        theirScore = m.score_a ?? 0;
      } else {
        continue;
      }

      if (Math.abs(myScore - theirScore) <= DRAW_MARGIN) {
        results.push('D');
      } else if (myScore > theirScore) {
        results.push('W');
      } else {
        results.push('L');
      }
    }
    return results;
  }

  const formMap = new Map<string, FormResult[]>();
  for (const row of standings) {
    formMap.set(row.team_id, computeForm(row.team_id, recentMatchups));
  }

  // ── Matchup hero state ────────────────────────────────────────────────────
  // Since we ordered by gameweek ASC, find() for scheduled gets the earliest one.
  const liveMatchup = myMatchups.find((m) => m.status === 'live');
  const scheduledMatchup = myMatchups.find((m) => m.status === 'scheduled');
  // For completed, we want the latest sequence, so we reverse it to search from highest GW
  const completedMatchup = [...myMatchups].reverse().find((m) => m.status === 'completed');

  let heroMatchup: typeof myMatchups[0] | null = null;
  let heroState: 'live' | 'upcoming' | 'final' | null = null;

  // Try to determine the current FPL gameweek as the primary anchor
  let currentFplGw = 1;
  let isCurrentFplGwFinished = false;
  let nextFplGwIsClose = false;
  
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 3600 } });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentFplGw = Math.max(currentFplGw, ev.id);
        }
      }
      const currentEvent = (fplData.events as any[]).find((e: any) => e.id === currentFplGw);
      isCurrentFplGwFinished = currentEvent?.finished ?? false;
      
      const nextGW = (fplData.events as any[]).find((e: any) => !e.finished && e.is_next);
      if (nextGW) {
        const daysUntil = (new Date(nextGW.deadline_time).getTime() - Date.now()) / 86400000;
        if (daysUntil <= 3) nextFplGwIsClose = true;
      }
    }
  } catch { /* FPL unreachable */ }

  const currentGwMatchup = myMatchups.find((m) => m.gameweek === currentFplGw);
  
  if (currentGwMatchup) {
    heroMatchup = currentGwMatchup;
    if (heroMatchup.status === 'live' || (heroMatchup.status === 'scheduled' && !isCurrentFplGwFinished)) {
      heroState = 'live';
    } else if (heroMatchup.status === 'completed' || isCurrentFplGwFinished) {
      if (nextFplGwIsClose) {
        // If next GW is very close, pivot to showing the upcoming one instead
        const upcomingMatchup = myMatchups.find((m) => m.gameweek === currentFplGw + 1) || scheduledMatchup;
        if (upcomingMatchup) {
          heroMatchup = upcomingMatchup;
          heroState = 'upcoming';
        } else {
          heroState = 'final';
        }
      } else {
        heroState = 'final';
      }
    } else {
      heroState = 'upcoming';
    }
  } else {
    // Fallbacks if current FPL GW doesn't align with local data
    if (liveMatchup) {
      heroMatchup = liveMatchup;
      heroState = 'live';
    } else if (scheduledMatchup && nextFplGwIsClose) {
      heroMatchup = scheduledMatchup;
      heroState = 'upcoming';
    } else if (completedMatchup) {
      heroMatchup = completedMatchup;
      heroState = 'final';
    }
  }

  // ── Derive result for final state ─────────────────────────────────────────
  let heroResult: 'win' | 'loss' | 'draw' | null = null;
  if (heroState === 'final' && heroMatchup && myTeamId) {
    if (heroMatchup.winner_team_id === null) heroResult = 'draw';
    else if (heroMatchup.winner_team_id === myTeamId) heroResult = 'win';
    else heroResult = 'loss';
  }

  // ── Top GW performers ────────────────────────────────────────────────────
  // Find most recently completed GW
  const latestCompletedGW = completedMatchup?.gameweek ?? null;
  let topPerformers: any[] = [];
  if (latestCompletedGW) {
    const { data: rawPerf } = await admin
      .from('player_stats')
      .select(`
        fantasy_points, match_rating, gameweek,
        player:players!player_id(id, web_name, name, primary_position, pl_team, photo_url)
      `)
      .eq('gameweek', latestCompletedGW)
      .eq('season', '2025-26')
      .order('fantasy_points', { ascending: false })
      .limit(5);

    if (rawPerf && rawPerf.length > 0) {
      // Find which team owns each player
      const playerIds = rawPerf.map((p) => (p.player as any)?.id).filter(Boolean);
      const { data: ownerEntries } = await admin
        .from('roster_entries')
        .select('player_id, team_id, team:teams!team_id(id, team_name)')
        .in('player_id', playerIds);

      const ownerMap: Record<string, { team_id: string; team_name: string }> = {};
      for (const e of ownerEntries ?? []) {
        if (!ownerMap[e.player_id]) {
          ownerMap[e.player_id] = {
            team_id: e.team_id,
            team_name: (e.team as any)?.team_name ?? 'Unknown',
          };
        }
      }

      topPerformers = rawPerf.map((p) => ({
        ...p,
        owner: ownerMap[(p.player as any)?.id] ?? null,
      }));
    }
  }

  // ── Hero helpers ─────────────────────────────────────────────────────────
  const isUserTeamA = heroMatchup?.team_a?.id === myTeamId;
  const userTeam = heroMatchup ? (isUserTeamA ? heroMatchup.team_a : heroMatchup.team_b) : null;
  const oppTeam = heroMatchup ? (isUserTeamA ? heroMatchup.team_b : heroMatchup.team_a) : null;
  const userScore = heroMatchup ? (isUserTeamA ? heroMatchup.score_a : heroMatchup.score_b) : null;
  const oppScore = heroMatchup ? (isUserTeamA ? heroMatchup.score_b : heroMatchup.score_a) : null;

  // ── Upcoming countdown pill for auctions ─────────────────────────────────
  function countdownMs(expiresAt: string): number {
    return new Date(expiresAt).getTime() - Date.now();
  }

  // ── Compute Team Records from Standings ──────────────────────────────────
  const userStanding = standings.find((s: any) => s.team_id === userTeam?.id);
  const oppStanding = standings.find((s: any) => s.team_id === oppTeam?.id);
  const userRecord = userStanding ? `${userStanding.wins}W · ${userStanding.draws}D · ${userStanding.losses}L` : '0W · 0D · 0L';
  const oppRecord = oppStanding ? `${oppStanding.wins}W · ${oppStanding.draws}D · ${oppStanding.losses}L` : '0W · 0D · 0L';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* Setup banner — only shown while league is in setup */}
      {(league.status === 'setup' || league.status === 'drafting') && (
        <div className={styles.setupBanner}>
          <DraftOrderManager
            leagueId={leagueId}
            initialTeams={initialTeams}
          />
        </div>
      )}

      {/* ── Dashboard Grid ── */}
      <div className={styles.bodyRow}>

        {/* ── Left Column ── */}
        <div className={styles.leftCol}>
          {/* Manager Card */}
          <div className={styles.managerCard}>
            <div className={styles.cardPadding}>
              <span className={styles.kickerLabel}>MANAGER</span>
              <h2 className={styles.managerName}>{myTeam?.team_name ?? 'Observer'}</h2>
              <span className={styles.managerOwner}>by {user.user_metadata?.username ?? user.user_metadata?.preferred_username ?? user.email?.split('@')[0] ?? 'Manager'}</span>
              
              <div className={styles.managerDivider} />
              
              <div className={styles.managerStatsRow}>
                <div className={styles.managerStat}>
                  <span className={styles.kickerLabel}>RANK</span>
                  <span className={styles.managerStatValue}>#{userStanding?.rank ?? '-'}</span>
                </div>
                <div className={styles.managerStat}>
                  <span className={styles.kickerLabel}>POINTS</span>
                  <span className={styles.managerStatValue}>{userStanding?.league_points?.toLocaleString() ?? '-'}</span>
                </div>
              </div>

              <div className={styles.managerDivider} />

              <div className={styles.managerRecordBlock}>
                <span className={styles.kickerLabel}>RECORD</span>
                <span className={styles.managerRecord}>{userRecord}</span>
              </div>
            </div>
          </div>

          {/* FAAB Balance Card */}
          <div className={styles.faabCard}>
            <div className={styles.cardPadding}>
              <span className={styles.kickerLabel}>BUDGET</span>
              <div className={styles.faabAmountRow}>
                <span className={styles.faabAmount}>£{myTeam?.faab_budget ?? 0}</span>
                <span className={styles.faabRemaining}>REMAINING</span>
              </div>
              <div className={styles.faabSpentLabel}>
                <span>SPENT THIS SEASON: £{200 - (myTeam?.faab_budget ?? 0)}</span>
              </div>
            </div>
          </div>

          {/* Taxi Squad */}
          <div className={styles.taxiCard}>
            <div className={styles.cardPadding}>
              <div className={styles.taxiHeaderRow}>
                <span className={styles.kickerLabel}>ACADEMY</span>
                <span className={styles.u21Badge}>U21</span>
              </div>
              
              {taxiSquad.length === 0 ? (
                <div className={styles.emptyStateBox}>
                  <div className={styles.emptyStateIcon}>⚽️</div>
                  <p className={styles.emptyHint}>No academy players.</p>
                </div>
              ) : (
                <div className={styles.taxiList}>
                  {taxiSquad.map((entry: any, i: number) => {
                    const player = entry.player;
                    const initials = (player.web_name ?? player.name ?? '?').split(' ').map((n: string) => n[0]).join('').substring(0, 2);
                    return (
                      <div key={i} className={styles.taxiRow}>
                        <div className={styles.taxiAvatar}>{initials}</div>
                        <div className={styles.taxiInfo}>
                          <span className={styles.taxiName}>{formatPlayerName(player, 'full')}</span>
                          <span className={styles.taxiPosClub}>{player.primary_position} • {player.pl_team}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Center Column ── */}
        <div className={styles.centerCol}>
          {/* Matchup Hero */}
          {heroMatchup && heroState && (
            <div className={styles.matchupHero}>
              <div className={styles.matchupTeam}>
                <div className={styles.matchupShield}>{userTeam?.team_name?.charAt(0) ?? '?'}</div>
                <span className={styles.matchupTeamName}>{userTeam?.team_name ?? '—'}</span>
                <span className={styles.matchupManager}>MANAGER {user.user_metadata?.full_name?.split(' ').pop()?.toUpperCase() ?? 'NAME'}</span>
              </div>
              
              <div className={styles.matchupCenter}>
                {heroState === 'live' && <span className={styles.matchupLiveBadge}>LIVE</span>}
                <div className={styles.matchupScoreRow}>
                  <span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (userScore?.toFixed(1) ?? '0.0')}</span>
                  <span className={styles.matchupScoreDash}>-</span>
                  <span className={styles.matchupScore}>{heroState === 'upcoming' ? '-' : (oppScore?.toFixed(1) ?? '0.0')}</span>
                </div>
                <span className={styles.matchupGwLabel}>MATCHWEEK {heroMatchup.gameweek}</span>
              </div>

              <div className={styles.matchupTeam}>
                <div className={styles.matchupShield}>{oppTeam?.team_name?.charAt(0) ?? '?'}</div>
                <span className={styles.matchupTeamName}>{oppTeam?.team_name ?? '—'}</span>
                <span className={styles.matchupManager}>MANAGER OPPONENT</span>
              </div>
            </div>
          )}

          {/* Transfer Gazette */}
          <div className={styles.gazetteCard}>
            <div className={styles.gazetteHeaderBar}>
              <span className={styles.gazetteTitle}>TRANSFER GAZETTE & FEED</span>
              <span className={styles.gazetteDate}>Edition: {new Date().toLocaleDateString('en-GB').replace(/\//g, '.')}</span>
            </div>
            
            <div className={styles.gazetteContent}>
              {activity.length === 0 ? (
                <div className={styles.emptyStateBox}>
                  <div className={styles.emptyStateIcon}>📰</div>
                  <p className={styles.emptyHint}>No activity yet this season.</p>
                </div>
              ) : (
                <div className={styles.gazetteList}>
                  {activity.map((tx: any) => {
                    const cat = txCategoryStyle(tx.type);
                    const teamName = (tx.team as any)?.team_name ?? 'Unknown';
                    const playerName = formatPlayerName(tx.player as any, 'initial_last');
                    const faab = tx.faab_bid ? ` for a fee of £${tx.faab_bid}m` : '';
                    
                    let summaryText = <></>;
                    if (tx.type === 'trade') summaryText = <>Trade completed by {teamName}.</>;
                    else if (tx.type === 'drop') summaryText = <>{playerName} dropped by {teamName}.</>;
                    else summaryText = <>{playerName} moves to {teamName}{faab}.</>;

                    return (
                      <div key={tx.id} className={styles.gazetteRow}>
                        <div className={styles.gazetteRowHeader}>
                          <span className={styles.gazetteRowKicker}>{cat.label}</span>
                          <span className={styles.gazetteRowTime}>{timeAgo(tx.processed_at)}</span>
                        </div>
                        <p className={styles.gazetteHeadline}>{summaryText}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className={styles.rightCol}>
          
          {/* League Standings */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>LEAGUE STANDINGS</span>
            <div className={styles.standingsTable}>
              <div className={styles.standingsHeader}>
                <span className={styles.stRank}>RK</span>
                <span className={styles.stTeam}>TEAM</span>
                <span className={styles.stPts}>PTS</span>
                <span className={styles.stForm}>FORM</span>
              </div>
              <div className={styles.standingsList}>
                {standings.slice(0, 5).map((s: any) => {
                  const isMe = s.team_id === myTeamId;
                  const form = formMap.get(s.team_id) ?? [];
                  return (
                    <div key={s.team_id} className={`${styles.standingsRow} ${isMe ? styles.stRowActive : ''}`}>
                      <span className={styles.stRankValue}>{s.rank}</span>
                      <span className={`${styles.stTeamName} ${isMe ? styles.stTeamNameBold : ''}`}>{s.team_name}</span>
                      <span className={styles.stPtsValue}>{s.league_points.toLocaleString()}</span>
                      <div className={styles.formDots}>
                        {form.map((result, idx) => (
                          <span
                            key={idx}
                            className={`${styles.formDot} ${
                              result === 'W'
                                ? styles.formDotW
                                : result === 'D'
                                ? styles.formDotD
                                : styles.formDotL
                            }`}
                          />
                        ))}
                        {Array.from({ length: Math.max(0, 5 - form.length) }).map((_, idx) => (
                          <span key={`empty-${idx}`} className={`${styles.formDot} ${styles.formDotEmpty}`} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.standingsFooter}>
                <Link href={`/league/${leagueId}/standings`} className={styles.cardLink}>VIEW FULL LEDGER</Link>
              </div>
            </div>
          </div>

          {/* Top Performers */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>TOP PERFORMERS (GW {latestCompletedGW ?? '—'})</span>
            {topPerformers.length === 0 ? (
               <p className={styles.emptyHint}>Not available.</p>
            ) : (
              <div className={styles.perfList}>
                {topPerformers.map((perf: any, i: number) => {
                  const player = perf.player;
                  if (!player) return null;
                  const pts = Number(perf.fantasy_points ?? 0);
                  const posMap: Record<string, string> = {
                    GK: 'var(--color-pos-gk)', CB: 'var(--color-pos-cb)', LB: 'var(--color-pos-fb)', RB: 'var(--color-pos-fb)',
                    DM: 'var(--color-pos-dm)', CM: 'var(--color-pos-cm)', LM: 'var(--color-pos-wm)', RM: 'var(--color-pos-wm)',
                    AM: 'var(--color-pos-am)', LW: 'var(--color-pos-lw)', RW: 'var(--color-pos-rw)', ST: 'var(--color-pos-st)',
                  };
                  const posColor = posMap[player.primary_position] ?? 'var(--color-bg-secondary)';

                  return (
                    <div key={i} className={styles.perfRow}>
                      <div className={styles.perfPhotoMount}>
                        {player.photo_url ? (
                          <img src={player.photo_url} alt="" className={styles.perfPhoto} />
                        ) : (
                          <div className={styles.perfPhotoFallback}>
                            {formatPlayerName(player, 'initial_last').charAt(0)}
                          </div>
                        )}
                      </div>
                      <span className={styles.perfBadge} style={{ backgroundColor: posColor, color: 'white' }}>{player.primary_position}</span>
                      <span className={styles.perfName}>{formatPlayerName(player, 'initial_last')}</span>
                      <div className={styles.perfScore}>
                        <span className={styles.perfPts}>{pts.toFixed(1)}</span>
                        <span className={styles.perfPtsUnit}>pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tournament Status */}
          <div className={styles.rightCard}>
            <span className={styles.kickerLabel}>TOURNAMENT STATUS</span>
            {tournaments.length === 0 ? (
              <div className={styles.emptyStateBox}>
                <div className={styles.emptyStateIcon}>🏆</div>
                <p className={styles.emptyHint}>No active tournaments.</p>
              </div>
            ) : (
              <div className={styles.tournList}>
                {tournaments.map((t: any) => (
                  <div key={t.id} className={styles.tournRow}>
                    <div className={styles.tournIcon}>🏆</div>
                    <div className={styles.tournInfo}>
                      <span className={styles.tournName}>{t.name}</span>
                      <span className={styles.tournDesc}>{t.status === 'active' ? `Round ${t.current_round ?? 1}` : t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>


      {/* Leave League (always available, bottom) */}
      <div className={styles.dangerZone}>
        <LeaveLeagueButton leagueId={leagueId} isCommissioner={league.commissioner_id === user.id} />
      </div>
    </div>
  );
}
