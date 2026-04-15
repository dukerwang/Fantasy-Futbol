import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
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
    CM: 'var(--color-pos-cm)', LM: 'var(--color-pos-cm)', RM: 'var(--color-pos-cm)',
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
    activityResult,
  ] = await Promise.all([
    // Full standings (no limit — show all teams)
    admin
      .from('league_standings')
      .select('team_id, team_name, rank, league_points, wins, draws, losses, played')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true }),

    // All matchups for user's team (need live, scheduled, and completed)
    myTeamId ? admin
      .from('matchups')
      .select('*, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
      .eq('league_id', leagueId)
      .or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`)
      .order('gameweek', { ascending: false })
      .limit(10) : Promise.resolve({ data: null }),

    // Live auctions
    admin
      .from('waiver_claims')
      .select(`
        id, team_id, faab_bid, expires_at,
        player:players!player_id(id, web_name, name, primary_position, pl_team),
        team:teams(id, team_name)
      `)
      .eq('league_id', leagueId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .order('faab_bid', { ascending: false })
      .limit(4),

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
  ]);

  const standings = standingsResult.data ?? [];
  const myMatchups = myMatchupsResult.data ?? [];
  const auctions = auctionsResult.data ?? [];
  const activity = activityResult.data ?? [];

  // ── Matchup hero state ────────────────────────────────────────────────────
  const liveMatchup = myMatchups.find((m) => m.status === 'live');
  const scheduledMatchup = myMatchups.find((m) => m.status === 'scheduled');
  const completedMatchup = myMatchups.find((m) => m.status === 'completed');

  let heroMatchup: typeof myMatchups[0] | null = null;
  let heroState: 'live' | 'upcoming' | 'final' | null = null;

  if (liveMatchup) {
    heroMatchup = liveMatchup;
    heroState = 'live';
  } else if (scheduledMatchup) {
    // Check FPL API for upcoming GW window (cached 1h — not called on every page load)
    try {
      const fplRes = await fetch(
        'https://fantasy.premierleague.com/api/bootstrap-static/',
        { next: { revalidate: 3600 } }
      );
      if (fplRes.ok) {
        const fplData = await fplRes.json();
        const nextGW = (fplData.events as any[])?.find((e) => !e.finished && e.is_next);
        if (nextGW) {
          const daysUntil = (new Date(nextGW.deadline_time).getTime() - Date.now()) / 86400000;
          if (daysUntil <= 3) {
            heroMatchup = scheduledMatchup;
            heroState = 'upcoming';
          }
        }
      }
    } catch {
      // FPL API unreachable — fall through to completed
    }
    if (!heroMatchup && completedMatchup) {
      heroMatchup = completedMatchup;
      heroState = 'final';
    }
  } else if (completedMatchup) {
    heroMatchup = completedMatchup;
    heroState = 'final';
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* Setup banner — only shown while league is in setup */}
      {(league.status === 'setup' || league.status === 'drafting') && (
        <div className={styles.setupBanner}>
          <DraftOrderManager
            leagueId={leagueId}
            leagueName={league.name}
            isCommissioner={league.commissioner_id === user.id}
            leagueStatus={league.status}
          />
        </div>
      )}

      {/* ── Zone 1: Matchup Hero ── */}
      {heroMatchup && heroState && (
        <div className={styles.heroCard}>
          {/* Left — user team */}
          <div className={styles.heroTeam}>
            <span className={styles.heroTeamLabel}>
              MY TEAM · GW {heroMatchup.gameweek}
            </span>
            <span className={styles.heroTeamName}>{userTeam?.team_name ?? '—'}</span>
            <span className={`${styles.heroScore} ${styles.heroScoreUser}`}>
              {heroState === 'upcoming' ? '—' : (userScore?.toFixed(1) ?? '0.0')}
            </span>
          </div>

          {/* Center */}
          <div className={styles.heroCenter}>
            {heroState === 'live' && (
              <span className={styles.heroBadgeLive}>● LIVE</span>
            )}
            {heroState === 'upcoming' && (
              <span className={styles.heroBadgeUpcoming}>UPCOMING</span>
            )}
            {heroState === 'final' && heroResult === 'win' && (
              <span className={styles.heroBadgeWin}>✓ WIN</span>
            )}
            {heroState === 'final' && heroResult === 'loss' && (
              <span className={styles.heroBadgeLoss}>LOSS</span>
            )}
            {heroState === 'final' && heroResult === 'draw' && (
              <span className={styles.heroBadgeDraw}>DRAW</span>
            )}
            <span className={styles.heroCenterLabel}>
              {heroState === 'final' ? 'FULL TIME' : heroState === 'live' ? 'IN PROGRESS' : 'AWAY'}
            </span>
          </div>

          {/* Right — opponent */}
          <div className={`${styles.heroTeam} ${styles.heroTeamRight}`}>
            <span className={styles.heroTeamLabel}>
              OPPONENT · GW {heroMatchup.gameweek}
            </span>
            <span className={`${styles.heroTeamName} ${styles.heroTeamNameMuted}`}>
              {oppTeam?.team_name ?? '—'}
            </span>
            <span className={`${styles.heroScore} ${styles.heroScoreOpp}`}>
              {heroState === 'upcoming' ? '—' : (oppScore?.toFixed(1) ?? '0.0')}
            </span>
          </div>
        </div>
      )}

      {/* No matchup yet */}
      {!heroMatchup && league.status === 'active' && (
        <div className={styles.heroEmpty}>
          <p>No matchup results yet — check back after GW 1.</p>
        </div>
      )}

      {/* ── Zone 2: Body Row (Standings + Right Column) ── */}
      <div className={styles.bodyRow}>

        {/* Left — League Standings */}
        <div className={styles.standingsCard}>
          <div className={styles.standingsHeading}>
            <span className={styles.sectionLabel}>2025/26 SEASON</span>
            <h2 className={styles.sectionTitle}>League Standings</h2>
            <div className={styles.standingsDivider} />
          </div>

          {/* Column headers */}
          <div className={styles.standingsHeaderRow}>
            <span className={styles.standingsColRnk}>#</span>
            <span className={styles.standingsColTeam}>TEAM</span>
            <span className={styles.standingsColRecord}>W·D·L</span>
            <span className={styles.standingsColPts}>PTS</span>
          </div>

          <div className={styles.standingsRows}>
            {standings.map((s) => {
              const isMe = s.team_id === myTeamId;
              const medal = rankMedalStyle(s.rank);
              return (
                <div key={s.team_id} className={`${styles.standingsRow} ${isMe ? styles.myStandingsRow : ''}`}>
                  <div className={styles.standingsColRnk}>
                    <span
                      className={styles.rankPill}
                      style={{ background: medal.bg, color: medal.color }}
                    >
                      {s.rank}
                    </span>
                  </div>
                  <div className={`${styles.standingsColTeam} ${isMe ? styles.myTeamName : ''}`}>
                    {s.team_name}
                    {isMe && <span className={styles.youTag}>YOU</span>}
                  </div>
                  <div className={styles.standingsColRecord}>
                    {s.wins}·{s.draws}·{s.losses}
                  </div>
                  <div className={`${styles.standingsColPts} ${isMe ? styles.myPts : ''}`}>
                    {s.league_points.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.standingsFooter}>
            <Link href={`/league/${leagueId}/standings`} className={styles.cardLink}>
              Full Standings →
            </Link>
          </div>
        </div>

        {/* Right column */}
        <div className={styles.rightCol}>

          {/* GW Stars */}
          <div className={styles.rightSection}>
            <span className={styles.sectionLabel}>
              GAMEWEEK {latestCompletedGW ?? '—'}
            </span>
            <h2 className={styles.sectionTitle}>Stars of the Week</h2>

            {topPerformers.length === 0 ? (
              <p className={styles.emptyHint}>
                {latestCompletedGW
                  ? 'Match ratings not yet available.'
                  : 'No completed gameweeks yet.'}
              </p>
            ) : (
              <div className={styles.playerChips}>
                {topPerformers.map((perf, i) => {
                  const player = perf.player as any;
                  if (!player) return null;
                  const isMyPlayer = perf.owner?.team_id === myTeamId;
                  const pts = Number(perf.fantasy_points ?? 0);
                  return (
                    <div
                      key={i}
                      className={`${styles.playerChip} ${isMyPlayer ? styles.myPlayerChip : ''}`}
                      style={{ borderLeftColor: positionColor(player.primary_position) }}
                    >
                      <div className={styles.chipLeft}>
                        <span
                          className={styles.chipPosBadge}
                          style={{ background: positionColor(player.primary_position) }}
                        >
                          {player.primary_position}
                        </span>
                        <div className={styles.chipInfo}>
                          <span className={styles.chipName}>{player.web_name ?? player.name}</span>
                          <span className={styles.chipClub}>{player.pl_team}</span>
                        </div>
                        {isMyPlayer && (
                          <span className={styles.chipMyTag}>★ Your squad</span>
                        )}
                      </div>
                      <span
                        className={styles.chipPoints}
                        style={{ background: pointsBadgeColor(pts) }}
                      >
                        {pts.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Bidding */}
          <div className={styles.rightSection}>
            <span className={styles.sectionLabel}>ACTIVE AUCTIONS</span>
            <h2 className={styles.sectionTitle}>Live Bidding</h2>

            {auctions.length === 0 ? (
              <p className={styles.emptyHint}>No active auctions.</p>
            ) : (
              <div className={styles.auctionRows}>
                {auctions.map((a: any) => {
                  const msTil = countdownMs(a.expires_at);
                  const hrsTil = msTil / 3600000;
                  const expired = msTil <= 0;
                  const countdownClass = expired
                    ? styles.countdownRed
                    : hrsTil < 2
                    ? styles.countdownRed
                    : hrsTil < 24
                    ? styles.countdownAmber
                    : styles.countdownGray;

                  const hh = Math.max(0, Math.floor(msTil / 3600000));
                  const mm = Math.max(0, Math.floor((msTil % 3600000) / 60000));

                  return (
                    <div key={a.id} className={styles.auctionRow}>
                      <div className={styles.auctionLeft}>
                        <span
                          className={styles.auctionPosBadge}
                          style={{ background: positionColor(a.player?.primary_position ?? '') }}
                        >
                          {a.player?.primary_position ?? '—'}
                        </span>
                        <div className={styles.auctionInfo}>
                          <span className={styles.auctionName}>
                            {a.player?.web_name ?? a.player?.name ?? 'Unknown'}
                          </span>
                          <span className={styles.auctionClub}>{a.player?.pl_team ?? ''}</span>
                        </div>
                      </div>
                      <div className={styles.auctionRight}>
                        <span className={styles.auctionBid}>£{a.faab_bid}m</span>
                        <span className={`${styles.auctionCountdown} ${countdownClass}`}>
                          {expired ? 'Processing' : `${hh}h ${mm}m`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Link href={`/league/${leagueId}/activity`} className={styles.cardLink}>
              View all auctions →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Zone 3: Transfer Gazette ── */}
      <div className={styles.gazette}>
        <div className={styles.gazetteHeader}>
          <span className={styles.breakingPill}>BREAKING</span>
          <h2 className={styles.gazetteTitle}>Transfer Gazette</h2>
          <span className={styles.gazetteEdition}>DAILY EDITION</span>
        </div>

        {activity.length === 0 ? (
          <p className={styles.emptyHint}>No activity yet this season.</p>
        ) : (
          <div className={styles.gazetteEntries}>
            {activity.map((tx: any) => {
              const cat = txCategoryStyle(tx.type);
              const teamName = (tx.team as any)?.team_name ?? 'Unknown';
              const playerName = (tx.player as any)?.web_name ?? (tx.player as any)?.name ?? 'Unknown';
              const faab = tx.faab_bid ? ` · £${tx.faab_bid}m FAAB` : '';
              const note = tx.notes ? ` — ${tx.notes}` : '';
              return (
                <div key={tx.id} className={styles.gazetteEntry}>
                  <span
                    className={styles.gazetteCategory}
                    style={{ background: cat.bg, color: cat.color }}
                  >
                    {cat.label}
                  </span>
                  <p className={styles.gazetteText}>
                    <strong>{teamName}</strong>{' '}
                    {tx.type === 'trade' ? (
                      <>completed a trade{note}</>
                    ) : tx.type === 'drop' ? (
                      <>released <strong>{playerName}</strong>{note}</>
                    ) : (
                      <>signed <strong>{playerName}</strong>{faab}{note}</>
                    )}
                  </p>
                  <span className={styles.gazetteTime}>{timeAgo(tx.processed_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leave League (always available, bottom) */}
      <div className={styles.dangerZone}>
        <LeaveLeagueButton leagueId={leagueId} />
      </div>
    </div>
  );
}
