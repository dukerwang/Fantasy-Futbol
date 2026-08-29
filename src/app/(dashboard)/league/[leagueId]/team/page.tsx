import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import { Icon } from '@/components/ui/Icon';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot } from '@/types';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, BENCH_FLEX_MAP } from '@/types';
import PitchUI from './PitchUI';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { getCurrentFplSeason, getLatestReferenceStatsSeason, isFplSeasonKickedOff, resolveDraftStatsSeason } from '@/lib/season/currentSeason';
import { resolveLineupEditMatchup } from '@/lib/lineups/editTarget';
import { getLockedPlTeamIds } from '@/lib/fixtures/lockout';
import { loadReferenceStats, type RefStatsMap } from '@/lib/scoring/matchups';
import type { RawStats } from '@/types';
import styles from './my-team.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function MyTeamPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Fetch full team data
    const { data: team } = await admin
    .from('teams')
    .select(`
      id, team_name, league_id,
      league:leagues(id, name, season, current_season, previous_season, status, scoring_rules, bench_size, taxi_size, taxi_age_limit, roster_size)
    `)
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!team) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>&#128085;</p>
        <h2 className={styles.emptyTitle}>No team found</h2>
        <p className={styles.emptyText}>You do not have a team in this league.</p>
        <a href="/dashboard" className={styles.backLink}>
          &larr; Back to dashboard
        </a>
      </div>
    );
  }


  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  let season = (team.league as any).current_season ?? (team.league as any).season ?? currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = await resolveDraftStatsSeason(admin, team.league as any);
  }

  // Fetch all player rankings and archives in parallel
  const [{ data: rankings }, { data: archives }, { data: listings }] = await Promise.all([
    admin.from('player_rankings').select('*'),
    admin.from('season_player_stats_archive').select('player_id, ppg, form_rating, overall_rank, position_ranks').eq('season', season),
    admin
      .from('player_sale_listings')
      .select('id, player_id, status, min_bid, buy_now_price')
      .eq('league_id', leagueId)
      .in('status', ['pending', 'active'])
  ]);

  const archiveMap = new Map((archives ?? []).map((a: any) => [a.player_id, a]));
  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
  const listingsMap = new Map((listings ?? []).map((l: any) => [l.player_id, l]));

  // Fetch roster entries with full player data (including rankings)
  const { data: rosterData } = await admin
    .from('roster_entries')
    .select(
      `
      id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at, on_trade_block,
      player:players(${FULL_PLAYER_SELECT})
    `
    )
    .eq('team_id', team.id)
    .order('status', { ascending: true });

  const rosterEntries = (rosterData ?? []).map((e: any) => {
    const player = e.player as any;
    if (player) {
      const ranks = rankMap.get(player.id);
      const arch = archiveMap.get(player.id);
      player.overall_rank = arch ? arch.overall_rank : ranks?.overall_rank;
      player.position_ranks = arch ? arch.position_ranks : ranks?.position_ranks;
      player.ppg = arch ? Number(arch.ppg) : player.ppg;
      player.form_rating = arch ? Number(arch.form_rating) : player.form_rating;
    }
    e.listing = listingsMap.get(e.player_id) ?? null;
    return e;
  });
  const starters = rosterEntries.filter((e) => e.status === 'active');
  const bench = rosterEntries.filter((e) => e.status === 'bench');
  const ir = rosterEntries.filter((e) => e.status === 'ir');
  const taxi = rosterEntries.filter((e) => e.status === 'taxi');
  // Lineup pool: active + bench status only (excludes IR and taxi — neither can be slotted into the lineup)
  const nonIrEntries = rosterEntries.filter((e) => e.status === 'active' || e.status === 'bench');

  const maxRosterSize = (team.league as any)?.roster_size ?? 20;
  const loanInCount = rosterEntries.filter((e) => e.status === 'loan_in').length;
  const activeRosterCount = rosterEntries.filter((e) => e.status !== 'ir' && e.status !== 'taxi' && e.status !== 'loan_in').length;

  const { data: pendingActivations } = await admin
    .from('player_loans')
    .select('id, player:players(name)')
    .eq('lender_team_id', team.id)
    .eq('status', 'pending_activation');

  // Fetch current GW player points for score overlay
  let currentFplGw = 0;
  const scoreMap: Record<string, number> = {};
  const rawStatsMap: Record<string, RawStats> = {};
  let refStats: RefStatsMap | undefined;
  // Minutes played this GW — undefined until the GW is known, so the pitch can
  // tell "no scoring context yet" apart from "played 0 minutes" (DNP).
  let minutesMap: Record<string, number> | undefined;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 300 }
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentFplGw = Math.max(currentFplGw, ev.id);
        }
      }
      if (currentFplGw) {
        const playerIds = rosterEntries.map((e) => e.player.id);
        const statsSeason = await getCurrentFplSeason(undefined, true);
        const refSeason = await getLatestReferenceStatsSeason(admin);
        const [{ data: statsRows }, fetchedRefStats] = await Promise.all([
          admin
            .from('player_stats')
            .select('player_id, fantasy_points, stats')
            .eq('season', statsSeason)
            .eq('gameweek', currentFplGw)
            .in('player_id', playerIds),
          loadReferenceStats(admin, refSeason),
        ]);
        refStats = fetchedRefStats;
        minutesMap = {};
        for (const s of statsRows ?? []) {
          scoreMap[s.player_id] = (scoreMap[s.player_id] ?? 0) + Number(s.fantasy_points);
          if (s.stats) rawStatsMap[s.player_id] = s.stats as RawStats;
          const minutes = Number((s.stats as { minutes_played?: number } | null)?.minutes_played ?? 0);
          minutesMap[s.player_id] = (minutesMap[s.player_id] ?? 0) + minutes;
        }
      }
    }
  } catch { /* non-critical — silently skip */ }

  // Determine initial formation and assignments from upcoming matchup lineup
  let initialFormation: Formation = '4-3-3';
  const initialAssignments: Record<number, string> = {};
  const initialBench: Record<string, string | null> = {
    DEF: null,
    MID: null,
    ATT: null,
    FLEX: null,
  };

  // This week until its last kickoff; next week after that — not until scores lock.
  const matchup = await resolveLineupEditMatchup(admin, team.id, currentFplGw);

  let lockedTeamIds = new Set<number>();

  // Build a set of active (non-IR) player IDs for sanitization
  const nonIrPlayerIds = new Set(nonIrEntries.map((e) => e.player.id));

  if (matchup) {
    const isTeamA = (matchup as any).team_a_id === team.id;
    let existingLineup = (isTeamA ? matchup.lineup_a : matchup.lineup_b) as MatchupLineup | null;

    // Fallback: If no lineup for this matchup, look for the most recent non-null lineup for this team
    if (!existingLineup) {
      const { data: pastMatchups } = await admin
        .from('matchups')
        .select('team_a_id, team_b_id, lineup_a, lineup_b')
        .or(`team_a_id.eq.${team.id},team_b_id.eq.${team.id}`)
        .lt('gameweek', (matchup as any).gameweek)
        .order('gameweek', { ascending: false })
        .limit(5);

      const lastSavedMatchup = pastMatchups?.find((m: any) => {
        const isA = m.team_a_id === team.id;
        return isA ? m.lineup_a : m.lineup_b;
      });

      if (lastSavedMatchup) {
        const isA = (lastSavedMatchup as any).team_a_id === team.id;
        existingLineup = (isA ? lastSavedMatchup.lineup_a : lastSavedMatchup.lineup_b) as MatchupLineup;
      }
    }

    if (existingLineup) {
      initialFormation = existingLineup.formation;
      const slots = FORMATION_SLOTS[existingLineup.formation];
      for (let i = 0; i < slots.length; i++) {
        const starter = existingLineup.starters[i];
        // Skip players who have since been moved to IR
        if (starter && nonIrPlayerIds.has(starter.player_id)) {
          initialAssignments[i] = starter.player_id;
        }
      }
      for (const b of existingLineup.bench || []) {
        // Skip players who have since been moved to IR
        if (b.slot && b.player_id && nonIrPlayerIds.has(b.player_id)) {
          initialBench[b.slot] = b.player_id;
        }
      }
    }

    lockedTeamIds = await getLockedPlTeamIds(admin, matchup.gameweek);
  }

  const { data: scoringMatchup } = await admin
    .from('matchups')
    .select('id, team_a_id, team_b_id, gameweek, status')
    .or(`team_a_id.eq.${team.id},team_b_id.eq.${team.id}`)
    .in('status', ['scheduled', 'live'])
    .order('gameweek', { ascending: true })
    .limit(1)
    .maybeSingle();
  const scoringLockedTeamIds =
    scoringMatchup && matchup && scoringMatchup.gameweek === matchup.gameweek
      ? lockedTeamIds
      : scoringMatchup
        ? await getLockedPlTeamIds(admin, scoringMatchup.gameweek)
        : new Set<number>();

  const editingAhead = !!(
    matchup && scoringMatchup && matchup.gameweek !== scoringMatchup.gameweek
  );
  const displayMatchup = scoringMatchup ?? matchup;

  let opponentTeamName: string | null = null;
  if (displayMatchup) {
    const isTeamA = displayMatchup.team_a_id === team.id;
    const opponentId = isTeamA ? displayMatchup.team_b_id : displayMatchup.team_a_id;
    if (opponentId) {
      const { data: oppTeam } = await admin
        .from('teams')
        .select('team_name')
        .eq('id', opponentId)
        .single();
      opponentTeamName = oppTeam?.team_name ?? null;
    }
  }
  const isMatchupLive = scoringLockedTeamIds.size > 0;

  // If no existing lineup, auto-assign starters based on current roster statuses
  if (Object.keys(initialAssignments).length === 0 && starters.length > 0) {
    const slots = FORMATION_SLOTS[initialFormation];
    const used = new Set<string>();

    for (let i = 0; i < slots.length; i++) {
      const slotPos = slots[i];
      const allowed = POSITION_FLEX_MAP[slotPos];
      const candidate = starters.find((e) => {
        if (used.has(e.player.id)) return false;
        const positions: GranularPosition[] = [
          e.player.primary_position,
          ...(e.player.secondary_positions ?? []),
        ];
        return positions.some((p) => allowed.includes(p));
      });
      if (candidate) {
        initialAssignments[i] = candidate.player.id;
        used.add(candidate.player.id);
      }
    }

    // Auto-assign bench slots (must match BENCH_FLEX_MAP so POST /lineup validation succeeds)
    const benchUsed = new Set<string>();
    const benchPool = bench;
    for (const slot of ['DEF', 'MID', 'ATT', 'FLEX'] as BenchSlot[]) {
      const allowed = BENCH_FLEX_MAP[slot];
      const candidate = benchPool.find((e) => {
        if (benchUsed.has(e.player.id)) return false;
        const positions: GranularPosition[] = [
          e.player.primary_position,
          ...(e.player.secondary_positions ?? []),
        ];
        return positions.some((p) => allowed.includes(p));
      });
      if (candidate) {
        initialBench[slot] = candidate.player.id;
        benchUsed.add(candidate.player.id);
      }
    }
  }

  const league = team.league as any;
  const taxiAgeLimit: number = league?.taxi_age_limit ?? 21;

  return (
    <div className={`${styles.page} g-page`}>
      <header className={styles.header}>
        <div className={styles.headerMeta}>
          <span className="g-label">{league.name}</span>
          {displayMatchup ? (
            <>
              <span className={styles.metaDot}>·</span>
              <span className={styles.metaChip}>
                <span className={styles.metaValue}>GW{displayMatchup.gameweek}</span>
              </span>
              {opponentTeamName && (
                <>
                  <span className={styles.metaDot}>vs</span>
                  <span className={styles.metaValue}>{opponentTeamName}</span>
                </>
              )}
              {isMatchupLive && (
                <>
                  <span className={styles.metaDot}>·</span>
                  <span className={styles.liveBadge}>Live</span>
                </>
              )}
              {editingAhead && matchup && (
                <>
                  <span className={styles.metaDot}>·</span>
                  <span className={styles.metaChip}>
                    <span className={styles.metaLabel}>Setting</span>
                    <span className={styles.metaValue}>GW{matchup.gameweek}</span>
                  </span>
                </>
              )}
            </>
          ) : null}
          <span className={styles.metaDot}>·</span>
          <span className={styles.metaChip}>
            <span className={styles.metaValue}>{activeRosterCount}/{maxRosterSize}</span>
            <span className={styles.metaLabel}>Active Roster</span>
            {loanInCount > 0 && <span className={styles.loanBadge}>+{loanInCount}L</span>}
          </span>
        </div>
        <h1 className={styles.teamName}>{team.team_name}</h1>
      </header>

      {pendingActivations && pendingActivations.length > 0 && (
        <div className={styles.capacityNote}>
          <span className={styles.capacityIcon}><Icon name="alert" size={16} /></span>
          <span>
            Roster Over Capacity. Drop a player to activate returned loan: {pendingActivations.map(p => (p.player as any)?.name).join(', ')}.
          </span>
          <NavigationLink href={`/league/${leagueId}/team/roster`} className={styles.capacityLink}>
            Go to Roster →
          </NavigationLink>
        </div>
      )}

      <PitchUI
        teamId={team.id}
        teamName={team.team_name}
        allEntries={nonIrEntries}
        irEntries={ir}
        taxiEntries={taxi}
        taxiAgeLimit={taxiAgeLimit}
        initialFormation={initialFormation}
        initialAssignments={initialAssignments}
        initialBench={initialBench as Record<BenchSlot, string | null>}
        scoreMap={scoreMap}
        minutesMap={minutesMap}
        rawStatsMap={rawStatsMap}
        refStats={refStats}
        gameweek={currentFplGw || undefined}
        lockedTeamIds={lockedTeamIds}
        scoringLockedTeamIds={scoringLockedTeamIds}
        lineupWeekLabel={editingAhead && matchup ? `GW${matchup.gameweek} lineup` : undefined}
        activeRosterCount={activeRosterCount}
        maxRosterSize={maxRosterSize}
      />
    </div>
  );
}
