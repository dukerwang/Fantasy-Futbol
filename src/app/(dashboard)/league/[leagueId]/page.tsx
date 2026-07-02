import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import NavigationLink from '@/components/ui/NavigationLink';
import { formatPlayerName } from '@/lib/formatName';
import styles from './league.module.css';
import DraftOrderManager from './DraftOrderManager';
import LeaveLeagueButton from './LeaveLeagueButton';
import PreDraftLobby from './PreDraftLobby';

import { getFplStatus } from '@/lib/fpl/api';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import TransferGazette from './TransferGazette';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
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
    .select('id, team_name, faab_budget, abbreviation')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  const myTeamId = myTeam?.id ?? null;

  if (myTeam && !myTeam.abbreviation) {
    redirect(`/league/${leagueId}/team-setup`);
  }

  // Check if league is active and ready for offseason reset
  let showSeasonCompleteBanner = false;
  if (league.status === 'active') {
    const [incompleteMatchupsRes, incompleteTourneysRes] = await Promise.all([
      admin
        .from('matchups')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .neq('status', 'completed'),
      admin
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .neq('status', 'completed')
    ]);

    const incompleteMatchups = incompleteMatchupsRes.count ?? 0;
    const incompleteTourneys = incompleteTourneysRes.count ?? 0;

    // Fetch total matchups count to ensure the league matches actually exist
    const { count: totalMatchups } = await admin
      .from('matchups')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    if (totalMatchups && totalMatchups > 0 && incompleteMatchups === 0 && incompleteTourneys === 0) {
      showSeasonCompleteBanner = true;
    }
  }

  // ── Parallel data fetches ────────────────────────────────────────────────
  const [
    standingsResult,
    myMatchupsResult,
    teamsResult,
    activityResult,
    taxiResult,
    tournamentsResult,
    recentMatchupsResult,
    spentResult,
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

    // All teams
    admin
      .from('teams')
      .select('id, team_name, draft_order, abbreviation, logo_url, user_id, user:users(id, username, email)')
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
      .limit(100),

    // Total spent this season (waiver_claim + drop severance) for my team
    myTeamId ? admin
      .from('transactions')
      .select('faab_bid, compensation_amount')
      .eq('league_id', leagueId)
      .eq('team_id', myTeamId)
      .in('type', ['waiver_claim', 'drop']) : Promise.resolve({ data: [] }),
  ]);

  const standings = standingsResult.data ?? [];
  let myMatchups = myMatchupsResult.data ?? [];
  const activity = activityResult.data ?? [];
  const initialTeams = (teamsResult.data ?? []) as any[];
  const taxiSquad = taxiResult?.data ?? [];
  const tournaments = tournamentsResult?.data ?? [];
  let recentMatchups = recentMatchupsResult?.data ?? [];

  // Compute total spent: sum faab_bid from waiver wins + compensation_amount from drops with severance
  const spentTxs = (spentResult as any)?.data ?? [];
  const totalSpentThisSeason = (spentTxs as any[]).reduce((sum: number, tx: any) => {
    const bid = tx.faab_bid != null && tx.faab_bid > 0 ? tx.faab_bid : 0;
    const sev = tx.compensation_amount != null && Number(tx.compensation_amount) > 0 ? Number(tx.compensation_amount) : 0;
    return sum + bid + sev;
  }, 0);

  // Self-healing: if the draft was auto-completed via SQL cron, matchups might not exist yet
  if (league.status === 'active' && recentMatchups.length === 0 && myMatchups.length === 0) {
    // Check if there are truly no matchups in the league
    const { count } = await admin.from('matchups').select('id', { count: 'exact', head: true }).eq('league_id', leagueId);
    if (count === 0) {
      const { insertMatchups } = await import('@/lib/schedule/insertMatchups');
      await insertMatchups(admin, leagueId).catch(console.error);
      
      // Also seed cup tournaments if they don't exist yet (brand new league)
      const { data: tourneys } = await admin
        .from('tournaments')
        .select('id')
        .eq('league_id', leagueId)
        .limit(1);

      if (!tourneys || tourneys.length === 0) {
        const { createAllTournaments } = await import('@/lib/tournaments/createTournaments');
        const { getCurrentFplSeason } = await import('@/lib/season/currentSeason');
        const season = league.current_season ?? await getCurrentFplSeason();
        await createAllTournaments(admin, leagueId, season).catch(console.error);
      }

      // Refresh myMatchups if they were just created
      if (myTeamId) {
        const { data: freshMyMatchups } = await admin
          .from('matchups')
          .select('*, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
          .eq('league_id', leagueId)
          .or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`)
          .order('gameweek', { ascending: true });
        if (freshMyMatchups) myMatchups = freshMyMatchups;
      }

      const { data: refreshedRecent } = await admin
        .from('matchups')
        .select('team_a_id, team_b_id, score_a, score_b, gameweek')
        .eq('league_id', leagueId)
        .eq('status', 'completed')
        .order('gameweek', { ascending: false })
        .limit(100);
      recentMatchups = refreshedRecent ?? [];
    }
  }

  // ── SERVER-SIDE SCORE SYNC ──────────────────────────────────────────────
  // If the current matchup shows 0.0-0.0, force a sync to avoid the initial flash
  const fplStatus = await getFplStatus();
  const currentFplGw = fplStatus.currentGw;
  const currentMatchup = myMatchups.find(m => m.gameweek === currentFplGw);

  if (currentMatchup && currentMatchup.status !== 'completed' && 
      parseFloat(currentMatchup.score_a) === 0 && parseFloat(currentMatchup.score_b) === 0) {
    await processMatchupsForGameweek(currentFplGw, fplStatus.isFinished);
    
    // Refresh myMatchups again with fresh scores
    if (myTeamId) {
      const { data: freshMyMatchups } = await admin
        .from('matchups')
        .select('*, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
        .eq('league_id', leagueId)
        .or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`)
        .order('gameweek', { ascending: true });
      if (freshMyMatchups) myMatchups = freshMyMatchups;
    }
  }

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

  const { isFinished: isCurrentFplGwFinished, nextGwIsClose: nextFplGwIsClose } = fplStatus;

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
      .eq('season', league.current_season ?? league.season)
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

  const userTeamFull = initialTeams.find((t: any) => t.id === userTeam?.id);
  const oppTeamFull = initialTeams.find((t: any) => t.id === oppTeam?.id);
  const userUsername = userTeamFull?.user?.username || 'MANAGER';
  const oppUsername = oppTeamFull?.user?.username || 'OPPONENT';

  // ── Compute Team Records from Standings ──────────────────────────────────
  const userStanding = standings.find((s: any) => s.team_id === userTeam?.id);
  const userRecord = userStanding ? `${userStanding.wins}W · ${userStanding.draws}D · ${userStanding.losses}L` : '0W · 0D · 0L';

  // If the league is in setup or drafting phase, render the dedicated Pre-Draft waiting room lobby
  if (league.status === 'setup' || league.status === 'drafting') {
    const isCommissioner = league.commissioner_id === user.id;
    const currentUsername = user.user_metadata?.username ?? user.user_metadata?.preferred_username ?? user.email?.split('@')[0] ?? 'Manager';
    const myDetailedTeam = initialTeams.find(t => t.user_id === user.id) ?? null;

    return (
      <PreDraftLobby
        leagueId={leagueId}
        league={league}
        teams={initialTeams}
        myUserId={user.id}
        myTeam={myDetailedTeam}
        currentUsername={currentUsername}
        isCommissioner={isCommissioner}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* ── Page Header ── */}
      <header className={styles.pageHeader}>
        <p className={`${styles.eyebrow} eyebrow`}>League Home</p>
        <h1 className={styles.pageTitle}>{league.name}</h1>
      </header>

      {/* Setup banner — only shown while league is in setup */}
      {(league.status === 'setup' || league.status === 'drafting') && (
        <div className={styles.setupBanner}>
          <DraftOrderManager
            leagueId={leagueId}
            initialTeams={initialTeams}
          />
        </div>
      )}

      {/* Season Complete Banner */}
      {showSeasonCompleteBanner && (
        <div className={styles.seasonCompleteBanner}>
          <div className={styles.bannerIcon} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="trophy" size={28} />
          </div>
          <div className={styles.bannerContent}>
            <h3>Season Complete! Ready for Offseason Reset</h3>
            <p>
              {league.commissioner_id === user.id
                ? 'All regular season matchups and cup tournaments are finished. As the commissioner, you can now run the end-of-season reset to distribute standings prizes, process relegation compensations, and transition to the next season.'
                : 'All matchups and cup tournaments have finished. The league is currently waiting for the commissioner to run the offseason reset and release prize payouts.'}
            </p>
          </div>
          {league.commissioner_id === user.id && (
            <Link href={`/league/${leagueId}/admin/offseason`} className={styles.bannerButton}>
              Go to Offseason Panel
            </Link>
          )}
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

          {/* Club Balance Card */}
          <NavigationLink href={`/league/${leagueId}/finance`} className={styles.faabCardLink}>
            <div className={styles.faabCard}>
              <div className={styles.cardPadding}>
                <span className={styles.kickerLabel}>CLUB BALANCE</span>
                <div className={styles.faabAmountRow}>
                  <span className={styles.faabAmount}>€{myTeam?.faab_budget ?? 0}m</span>
                  <span className={styles.faabRemaining}>AVAILABLE</span>
                </div>
                <div className={styles.faabSpentLabel}>
                  <span>SPENT THIS SEASON: €{totalSpentThisSeason}m</span>
                </div>
              </div>
            </div>
          </NavigationLink>

          {/* Taxi Squad */}
          <div className={styles.taxiCard}>
            <div className={styles.cardPadding}>
              <div className={styles.taxiHeaderRow}>
                <span className={styles.kickerLabel}>ACADEMY</span>
                <span className={styles.u21Badge}>U21</span>
              </div>
              
              {taxiSquad.length === 0 ? (
                <div className={styles.emptyStateBox}>
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
            <NavigationLink href={`/league/${leagueId}/matchups/${heroMatchup.id}`} className={styles.matchupHeroLink}>
              <div className={styles.matchupHero}>
                <div className={styles.matchupHeader}>
                  <span className={styles.matchupGwLabel}>MATCHWEEK {heroMatchup.gameweek}</span>
                  {heroState === 'live' && <span className={styles.matchupLiveBadge}>Live</span>}
                </div>
                <div className={styles.matchupBody}>
                  {/* Row 1: Teams side by side */}
                  <div className={styles.matchupTeamsRow}>
                    {/* Team A */}
                    <div className={styles.matchupTeamInfoA}>
                      <div className={styles.matchupShield}>{userTeam?.team_name?.charAt(0) ?? '?'}</div>
                      <div className={styles.matchupTeamDetails}>
                        <span className={styles.matchupTeamName}>{userTeam?.team_name ?? '—'}</span>
                        <span className={styles.matchupManager}>MANAGER {userUsername.toUpperCase()}</span>
                      </div>
                    </div>
                    {/* Team B */}
                    <div className={styles.matchupTeamInfoB}>
                      <div className={styles.matchupTeamDetails}>
                        <span className={styles.matchupTeamName}>{oppTeam?.team_name ?? '—'}</span>
                        <span className={styles.matchupManager}>MANAGER {oppUsername.toUpperCase()}</span>
                      </div>
                      <div className={styles.matchupShield}>{oppTeam?.team_name?.charAt(0) ?? '?'}</div>
                    </div>
                  </div>

                  {/* Row 2: Scores anchored under each team */}
                  <div className={styles.matchupScoresRow}>
                    {/* Score A stack */}
                    <div className={`${styles.matchupScoreStack} ${heroState !== 'upcoming' && (userScore ?? 0) > (oppScore ?? 0) ? styles.matchupScoreWin : heroState !== 'upcoming' && (userScore ?? 0) < (oppScore ?? 0) ? styles.matchupScoreLose : ''}`}>
                      <span className={styles.matchupScoreNum}>
                        {heroState === 'upcoming' ? '—' : (userScore?.toFixed(2) ?? '0.00')}
                      </span>
                      <span className={styles.matchupScoreLabel}>PTS</span>
                    </div>

                    <div className={styles.matchupScoreDivider} />

                    {/* Score B stack */}
                    <div className={`${styles.matchupScoreStack} ${styles.matchupScoreStackB} ${heroState !== 'upcoming' && (oppScore ?? 0) > (userScore ?? 0) ? styles.matchupScoreWin : heroState !== 'upcoming' && (oppScore ?? 0) < (userScore ?? 0) ? styles.matchupScoreLose : ''}`}>
                      <span className={styles.matchupScoreNum}>
                        {heroState === 'upcoming' ? '—' : (oppScore?.toFixed(2) ?? '0.00')}
                      </span>
                      <span className={styles.matchupScoreLabel}>PTS</span>
                    </div>
                  </div>
                </div>
              </div>
            </NavigationLink>
          )}

          {/* Transfer Gazette */}
          <TransferGazette activity={activity} />
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
                <NavigationLink href={`/league/${leagueId}/standings`} className={styles.cardLink}>VIEW FULL STANDINGS</NavigationLink>
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
                    LWB: 'var(--color-pos-wb)', RWB: 'var(--color-pos-wb)',
                    DM: 'var(--color-pos-dm)', CM: 'var(--color-pos-cm)',
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
                      <div className={styles.perfDetails}>
                        <span className={styles.perfName}>{formatPlayerName(player, 'initial_last')}</span>
                        <span className={styles.perfTeamName}>{player.pl_team}</span>
                      </div>
                      <div className={styles.perfScoreBadge}>
                        <span className={styles.perfPtsValue}>{pts.toFixed(2)}</span>
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
                <p className={styles.emptyHint}>No active tournaments.</p>
              </div>
            ) : (
              <div className={styles.tournList}>
                {tournaments.map((t: any) => (
                  <div key={t.id} className={styles.tournRow}>
                    <div className={styles.tournIcon} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="trophy" size={16} />
                    </div>
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
