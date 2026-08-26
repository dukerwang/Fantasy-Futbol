/**
 * src/lib/players/cardData.ts
 *
 * Server-side data assembly for the premium player card.
 *
 * The card has two faces with very different cost profiles:
 *
 *   FRONT — identity, club, photo, rating, points, ranks, owner crest.
 *           Pure Supabase. Every field is already loaded by the list pages
 *           that open the card, so this should almost never be fetched at all.
 *
 *   BACK  — game log and career history. Needs FPL's element-summary /
 *           bootstrap / fixtures endpoints, which are slow and third-party.
 *
 * Keeping them apart is the whole point: the front must never wait on the
 * back. `/api/players/[id]/card` serves the front, `/api/players/[id]/log`
 * serves the back, and the legacy combined route composes both.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import {
  getCurrentFplSeason,
  getLatestReferenceStatsSeason,
  isFplSeasonKickedOff,
  previousSeason,
} from '@/lib/season/currentSeason';
import { getClubFixtureLog, type ClubFixtureLog } from '@/lib/fixtures/lockout';
import { loadReferenceStats } from '@/lib/scoring/matchups';
import { buildPerformanceGroups, type PerfGroup } from '@/lib/scoring/perfBand';
import { calculateMatchRating, featExcessFor } from '@/lib/scoring/matchRating';
import type {
  GranularPosition,
  OwnerClub,
  Player,
  PlayerOwnership,
  PlayerSeasonArchive,
  RawStats,
} from '@/types';

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ResolvedSeason {
  targetSeason: string;
  currentFplSeason: string;
  isCurrentFplSeason: boolean;
}

/** Points + rating for one appearance evaluated at a specific slot. */
export interface PositionGameScore {
  fantasy_points: number;
  match_rating: number | null;
}

export interface GamelogEntry {
  gameweek: number;
  fantasy_points: number;
  match_rating: number | null;
  stats: { minutes_played?: number; goals?: number; assists?: number } | null;
  opponent?: string;
  result?: string;
  date?: string;
  isDNP?: boolean;
  /**
   * The match's performance block, already BANDED, and deliberately without
   * the underlying scores: see the header of src/lib/scoring/perfBand.ts.
   * Quantising the bar in CSS is theatre if the composite travels beside it in
   * this payload.
   *
   * Read from `player_stats.perf` where the sync stored it (migration 140), so
   * the explanation matches the engine that produced the points; rebuilt on the
   * server for rows written before that.
   */
  perf?: PerfGroup[];
  /**
   * Same appearance re-scored under every eligible slot (primary + secondaries).
   * Primary uses the stored values; secondaries go through calculateMatchRating
   * with that position's weights — same path as positional ranks / role-aware
   * matchup scoring.
   */
  by_position?: Record<string, PositionGameScore>;
}

export interface PlayerCardFront {
  player: Player;
  ownership: PlayerOwnership | null;
  season: string;
}

export interface PlayerCardBack {
  gamelog: GamelogEntry[];
  history: PlayerSeasonArchive[];
  season: string;
}

type RefStatsMap = Parameters<typeof calculateMatchRating>[2];

/** Primary first, then unique secondaries — the slots a manager can actually play him in. */
function eligiblePositions(
  primary: string | null | undefined,
  secondaries: string[] | null | undefined,
): string[] {
  const out: string[] = [];
  const prim = primary ? String(primary).toUpperCase() : '';
  if (prim) out.push(prim);
  for (const s of secondaries ?? []) {
    const key = String(s).toUpperCase();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Annotate each played appearance with by_position scores. DNPs stay untouched.
 * Primary keeps the stored fantasy_points / match_rating so the default view
 * never drifts from what the sync wrote; secondaries are re-scored live.
 *
 * Points include the OOP penalty (same number a matchup would award). Display
 * rating does NOT — applying OOP after the nonlinear curves parked great
 * games at ~6.5 RTG beside ~18 pts, which reads as "rating doesn't match
 * points". Rating here is the performance under that slot's weights; points
 * are what you'd actually bank.
 */
function attachPositionScores(
  gamelog: GamelogEntry[],
  primary: string,
  positions: string[],
  refStats: RefStatsMap,
): GamelogEntry[] {
  // No early return on an empty `positions`: the performance block is built for
  // every player, and most of the pool has no secondary slot at all.
  const prim = primary.toUpperCase() as GranularPosition;

  return gamelog.map((g) => {
    if (g.isDNP || Number(g.stats?.minutes_played ?? 0) <= 0) return g;

    const by_position: Record<string, PositionGameScore> = {};
    for (const pos of positions) {
      if (pos === prim) {
        by_position[pos] = {
          fantasy_points: Number(g.fantasy_points),
          match_rating: g.match_rating,
        };
        continue;
      }
      if (!g.stats) {
        by_position[pos] = { fantasy_points: 0, match_rating: null };
        continue;
      }
      const raw = g.stats as RawStats;
      const slot = pos as GranularPosition;
      // Matchup-accurate points (OOP applied).
      const forPoints = calculateMatchRating(raw, slot, refStats, prim);
      // Positional display rating without the post-curve OOP squash.
      const forRating = calculateMatchRating(raw, slot, refStats);
      by_position[pos] = {
        fantasy_points: forPoints.fantasyPoints,
        match_rating: forRating.rating,
      };
    }

    // The block, at the player's PRIMARY slot.
    //
    // PREFER THE SNAPSHOT. Since migration 140 the sync stores the bands beside
    // the points they explain, so a completed match is described by the engine
    // that actually scored it. Re-scoring here would describe it with today's
    // engine instead, and those have already diverged — the rare-feat rule
    // changed on 2026-08-25 and completed history was deliberately not
    // backfilled, so a re-scored hat-trick would show the new feat mark next to
    // points computed under the old one.
    //
    // The fallback still re-scores, for every row written before 140.
    let perf: PerfGroup[] | undefined = g.perf;
    if (!perf && g.stats) {
      const raw = g.stats as RawStats;
      const primaryRating = calculateMatchRating(raw, prim, refStats);
      perf = buildPerformanceGroups(primaryRating.breakdown, prim, raw, featExcessFor(raw, prim));
    }

    return positions.length > 0 ? { ...g, by_position, perf } : { ...g, perf };
  });
}

/**
 * Which season a card should describe. A league that has rolled into a new
 * season before FPL has actually kicked off still shows last season's numbers,
 * otherwise every card reads zero for weeks.
 */
export async function resolveCardSeason(
  admin: SupabaseClient,
  leagueId?: string | null,
  explicitSeason?: string | null,
): Promise<ResolvedSeason> {
  const [currentFplSeason, kickedOff] = await Promise.all([
    getCurrentFplSeason(),
    isFplSeasonKickedOff(),
  ]);

  let targetSeason = explicitSeason ?? null;

  if (!targetSeason && leagueId) {
    const { data: lg } = await admin
      .from('leagues')
      .select('current_season, previous_season')
      .eq('id', leagueId)
      .maybeSingle();
    if (lg?.current_season) {
      targetSeason = lg.current_season;
      if (targetSeason === currentFplSeason && !kickedOff) {
        targetSeason = lg.previous_season ?? targetSeason;
      }
    }
  }

  if (!targetSeason) {
    targetSeason = currentFplSeason;
    if (!kickedOff) targetSeason = previousSeason(targetSeason);
  }

  return {
    targetSeason,
    currentFplSeason,
    isCurrentFplSeason: targetSeason === currentFplSeason,
  };
}

function toOwnerClub(team: {
  id: string;
  team_name: string;
  abbreviation: string | null;
  crest_config: unknown | null;
} | undefined): OwnerClub | null {
  if (!team) return null;
  return {
    teamId: team.id,
    teamName: team.team_name,
    abbreviation: team.abbreviation ?? null,
    crestConfig: team.crest_config ?? null,
  };
}

/**
 * Collapses a player's roster entries in one league into an owner + optional
 * borrower. During a loan there are two rows: the lender keeps `loan_out` and
 * holds the contract, the borrower gets `loan_in` and fields him.
 */
function resolveOwnership(
  entries: { team_id: string; status: string }[],
  teamById: Map<string, any>,
): PlayerOwnership | null {
  if (entries.length === 0) return null;
  const lender = entries.find((e) => e.status === 'loan_out');
  const borrower = entries.find((e) => e.status === 'loan_in');
  const held = entries.find((e) => e.status !== 'loan_in' && e.status !== 'loan_out');
  const ownerEntry = lender ?? held ?? entries[0];
  const owner = toOwnerClub(teamById.get(ownerEntry.team_id));
  if (!owner) return null;
  return { owner, loanedTo: borrower ? toOwnerClub(teamById.get(borrower.team_id)) : null };
}

/**
 * Owner crest data for every held player in a league, keyed by player id.
 *
 * List pages call this once and hand the result down, so opening a card costs
 * zero requests. Two queries total regardless of roster size.
 */
export async function buildLeagueOwnershipMap(
  admin: SupabaseClient,
  leagueId: string,
): Promise<Record<string, PlayerOwnership>> {
  // Run both queries in parallel — roster_entries filters by league_id via an inner
  // join on teams, following the same PostgREST pattern used in matchupProcessor.
  const [teamsRes, entriesRes] = await Promise.all([
    admin
      .from('teams')
      .select('id, team_name, abbreviation, crest_config')
      .eq('league_id', leagueId),
    admin
      .from('roster_entries')
      .select('player_id, team_id, status, team:teams!team_id!inner(league_id)')
      .eq('team.league_id', leagueId),
  ]);

  const leagueTeams = teamsRes.data;
  if (!leagueTeams || leagueTeams.length === 0) return {};

  const teamById = new Map(leagueTeams.map((t: any) => [t.id, t]));

  const byPlayer = new Map<string, { team_id: string; status: string }[]>();
  for (const e of entriesRes.data ?? []) {
    const list = byPlayer.get(e.player_id);
    if (list) list.push(e);
    else byPlayer.set(e.player_id, [e]);
  }

  const out: Record<string, PlayerOwnership> = {};
  for (const [playerId, playerEntries] of byPlayer) {
    const ownership = resolveOwnership(playerEntries, teamById);
    if (ownership) out[playerId] = ownership;
  }
  return out;
}

/**
 * Everything the front of the card renders, for one player.
 *
 * All independent queries run concurrently — the season resolve is the only
 * thing anything else depends on.
 */
export async function fetchPlayerFront(
  admin: SupabaseClient,
  playerId: string,
  leagueId?: string | null,
  explicitSeason?: string | null,
): Promise<PlayerCardFront | null> {
  const season = await resolveCardSeason(admin, leagueId, explicitSeason);

  const playerPromise = admin
    .from('players')
    .select(FULL_PLAYER_SELECT)
    .eq('id', playerId)
    .single();

  // Live rankings for the current season, the frozen archive row otherwise.
  const ranksPromise = season.isCurrentFplSeason
    ? admin
        .from('player_rankings')
        .select('overall_rank, position_ranks')
        .eq('player_id', playerId)
        .maybeSingle()
    : admin
        .from('season_player_stats_archive')
        .select('total_points, ppg, form_rating, overall_rank, position_ranks')
        .eq('player_id', playerId)
        .eq('season', season.targetSeason)
        .maybeSingle();

  const ownershipPromise = leagueId
    ? fetchPlayerOwnership(admin, playerId, leagueId)
    : Promise.resolve(null);

  const [{ data: fullPlayer, error }, ranksResult, ownership] = await Promise.all([
    playerPromise,
    ranksPromise,
    ownershipPromise,
  ]);

  if (error || !fullPlayer) return null;

  // The live-rankings and archive branches select different columns, so the
  // union has no useful shape — the archived flag below decides what to read.
  const rankRow = ranksResult.data as any;
  const p = fullPlayer as any;
  const archived = !season.isCurrentFplSeason;

  // players.total_points/ppg/form_rating are live current-season caches, so a
  // past-season card has to take all three from the archive or it shows this
  // season's totals beside that season's rank.
  const player = {
    ...p,
    total_points: archived ? Number(rankRow?.total_points ?? 0) : p.total_points,
    ppg: archived ? Number(rankRow?.ppg ?? 0) : p.ppg,
    form_rating: archived ? Number(rankRow?.form_rating ?? 0) : p.form_rating,
    overall_rank: rankRow?.overall_rank ?? null,
    position_ranks: rankRow?.position_ranks ?? null,
  } as Player;

  return { player, ownership, season: season.targetSeason };
}

/**
 * The club a player actually turned out for in an archived season.
 *
 * `players.pl_team` cannot answer this: it is overwritten every rollover, so
 * for an archived season it names the player's club TODAY. Joining a 2025-26
 * game log on it would give every summer transfer the wrong club's fixtures.
 *
 * `player_season_clubs` is the per-season record. Until it is populated this
 * returns null, which degrades to "Unknown" — the same as before, and far
 * better than a plausible-looking wrong opponent.
 */
async function resolveArchivedClub(
  admin: SupabaseClient,
  playerId: string,
  season: string,
): Promise<string | null> {
  const { data } = await admin
    .from('player_season_clubs')
    .select('club_slug')
    .eq('player_id', playerId)
    .eq('season', season)
    .maybeSingle();

  return (data as { club_slug: string } | null)?.club_slug ?? null;
}

/** Single-player ownership lookup. Two queries, no FPL involvement. */
export async function fetchPlayerOwnership(
  admin: SupabaseClient,
  playerId: string,
  leagueId: string,
): Promise<PlayerOwnership | null> {
  const { data: leagueTeams } = await admin
    .from('teams')
    .select('id, team_name, abbreviation, crest_config')
    .eq('league_id', leagueId);

  if (!leagueTeams || leagueTeams.length === 0) return null;

  const teamById = new Map(leagueTeams.map((t: any) => [t.id, t]));
  const { data: entries } = await admin
    .from('roster_entries')
    .select('team_id, status')
    .eq('player_id', playerId)
    .in('team_id', Array.from(teamById.keys()));

  return resolveOwnership(entries ?? [], teamById);
}

/**
 * Game log + career history for the back of the card.
 *
 * For the current season the DB rows are bridged against FPL's element-summary
 * so DNPs, opponents and scorelines appear in chronological order. All three
 * FPL calls are issued together — element-summary does not need the team map
 * to start, only to be interpreted.
 */
export async function fetchPlayerBack(
  admin: SupabaseClient,
  playerId: string,
  leagueId?: string | null,
  explicitSeason?: string | null,
): Promise<PlayerCardBack> {
  const season = await resolveCardSeason(admin, leagueId, explicitSeason);

  const refSeasonPromise = getLatestReferenceStatsSeason(admin);

  const [{ data: playerRow }, { data: dbStats }, { data: historyData }, refSeason] = await Promise.all([
    admin
      .from('players')
      .select('fpl_id, pl_team_id, pl_team, name, primary_position, secondary_positions')
      .eq('id', playerId)
      .maybeSingle(),
    admin
      .from('player_stats')
      .select('match_id, gameweek, fantasy_points, match_rating, stats, perf')
      .eq('player_id', playerId)
      .eq('season', season.targetSeason),
    admin
      .from('season_player_stats_archive')
      .select('season, total_points, ppg, form_rating, overall_rank, position_ranks')
      .eq('player_id', playerId)
      .order('season', { ascending: false }),
    refSeasonPromise,
  ]);

  const history = (historyData ?? []) as PlayerSeasonArchive[];
  const stats = (dbStats ?? []) as any[];
  const primaryPos = String((playerRow as any)?.primary_position ?? '').toUpperCase();
  const positions = eligiblePositions(
    (playerRow as any)?.primary_position,
    (playerRow as any)?.secondary_positions,
  );
  // Ref stats for re-scoring secondaries — same source positional ranks use.
  const refStats = (await loadReferenceStats(admin, refSeason)) as RefStatsMap;

  const withPositionScores = (log: GamelogEntry[]): GamelogEntry[] =>
    attachPositionScores(log, primaryPos, positions, refStats);

  const buildDbFallbackLog = (): GamelogEntry[] =>
    withPositionScores(
      stats
        .map((s) => ({
          gameweek: s.gameweek,
          fantasy_points: Number(s.fantasy_points),
          match_rating: s.match_rating != null ? Number(s.match_rating) : null,
          stats: s.stats,
          opponent: 'Unknown',
          result: '',
          isDNP: Number(s.stats?.minutes_played ?? 0) <= 0,
        }))
        .sort((a, b) => b.gameweek - a.gameweek),
    );

  // Past seasons resolve entirely from our own fixture snapshot. FPL cannot be
  // asked: it stops serving a season's fixtures once it rolls over, and recycles
  // fixture ids 1-380 every year, so its live data would name a confidently
  // WRONG opponent for an archived match rather than no opponent at all.
  if (!season.isCurrentFplSeason || !playerRow) {
    if (!playerRow) {
      return { gamelog: buildDbFallbackLog(), history, season: season.targetSeason };
    }
    // players.pl_team is the player's CURRENT club, not their club in the
    // archived season — the table gets re-synced each rollover, so anyone who
    // transferred over the summer would be joined against the wrong club's
    // fixtures and shown a confidently wrong opponent.
    const clubName = await resolveArchivedClub(admin, playerId, season.targetSeason);
    const fixtureLog: ClubFixtureLog = clubName
      ? await getClubFixtureLog(admin, season.targetSeason, clubName)
      : { byFixture: new Map(), byGameweek: new Map() };

    const fixtures = Array.from(fixtureLog.byFixture.values()).sort(
      (a, b) => a.gameweek - b.gameweek || a.fixtureId - b.fixtureId,
    );

    // Drive the log from the club's fixtures so every matchweek appears. Stats
    // rows are optional — many DNPs were never written to player_stats at all,
    // and filtering to existing rows is what made the card skip them.
    const statsByMatchId = new Map(stats.map((s) => [Number(s.match_id), s]));
    const claimedStats = new Set<any>();
    const fixtureStats = new Map<number, any>();

    for (const fx of fixtures) {
      const exact = statsByMatchId.get(fx.fixtureId);
      if (exact && !claimedStats.has(exact)) {
        fixtureStats.set(fx.fixtureId, exact);
        claimedStats.add(exact);
      }
    }
    for (const fx of fixtures) {
      if (fixtureStats.has(fx.fixtureId)) continue;
      const free = stats
        .filter((s) => s.gameweek === fx.gameweek && !claimedStats.has(s))
        .sort((a, b) => Number(b.stats?.minutes_played ?? 0) - Number(a.stats?.minutes_played ?? 0))[0];
      if (free) {
        fixtureStats.set(fx.fixtureId, free);
        claimedStats.add(free);
      }
    }

    const formatFixture = (fx: NonNullable<ReturnType<typeof fixtureLog.byFixture.get>>) => {
      const opponent = `${fx.opponentShortName} (${fx.isHome ? 'H' : 'A'})`;
      let result = '';
      if (fx.finished && fx.scoreFor != null && fx.scoreAgainst != null) {
        const outcome =
          fx.scoreFor > fx.scoreAgainst ? 'W' : fx.scoreFor < fx.scoreAgainst ? 'L' : 'D';
        const [h, a] = fx.isHome
          ? [fx.scoreFor, fx.scoreAgainst]
          : [fx.scoreAgainst, fx.scoreFor];
        result = `${outcome} ${h}-${a}`;
      }
      return { opponent, result };
    };

    const gamelog: GamelogEntry[] = fixtures.map((fx) => {
      const s = fixtureStats.get(fx.fixtureId) ?? null;
      const minutes = Number(s?.stats?.minutes_played ?? 0);
      const isDNP = !s || minutes <= 0;
      const { opponent, result } = formatFixture(fx);

      if (isDNP) {
        return {
          gameweek: fx.gameweek,
          fantasy_points: 0,
          match_rating: null,
          stats: { minutes_played: 0, goals: 0, assists: 0 },
          opponent,
          result,
          isDNP: true,
        };
      }

      return {
        gameweek: fx.gameweek,
        fantasy_points: Number(s.fantasy_points),
        match_rating: s.match_rating != null ? Number(s.match_rating) : null,
        stats: s.stats,
        perf: (s.perf as PerfGroup[] | null) ?? undefined,
        opponent,
        result,
        isDNP: false,
      };
    });

    // Keep any played row that somehow didn't attach to a fixture rather than
    // silently dropping points from the log.
    for (const s of stats) {
      if (claimedStats.has(s)) continue;
      if (Number(s.stats?.minutes_played ?? 0) <= 0) continue;
      gamelog.push({
        gameweek: s.gameweek,
        fantasy_points: Number(s.fantasy_points),
        match_rating: s.match_rating != null ? Number(s.match_rating) : null,
        stats: s.stats,
        perf: (s.perf as PerfGroup[] | null) ?? undefined,
        opponent: 'Unknown',
        result: '',
        isDNP: false,
      });
    }

    gamelog.sort((a, b) => b.gameweek - a.gameweek);
    return { gamelog: withPositionScores(gamelog), history, season: season.targetSeason };
  }

  const dbPlayer = playerRow as { fpl_id: number | null; pl_team_id: number | null; name: string };
  const statsMap = new Map(stats.map((s) => [Number(s.match_id), s]));

  try {
    const [bootRes, fixRes, histRes] = await Promise.all([
      fetch(`${FPL_BASE}/bootstrap-static/`, {
        headers: { 'User-Agent': USER_AGENT },
        next: { revalidate: 3600 },
      }),
      fetch(`${FPL_BASE}/fixtures/`, {
        headers: { 'User-Agent': USER_AGENT },
        next: { revalidate: 3600 },
      }),
      dbPlayer.fpl_id
        ? fetch(`${FPL_BASE}/element-summary/${dbPlayer.fpl_id}/`, {
            headers: { 'User-Agent': USER_AGENT },
            next: { revalidate: 300 },
          })
        : Promise.resolve(null),
    ]);

    const teamMap = new Map<number, { name: string; short: string }>();
    const fixtureMap = new Map<number, any>();

    if (bootRes.ok) {
      const bootData = await bootRes.json();
      bootData.teams?.forEach((t: any) => teamMap.set(t.id, { name: t.name, short: t.short_name }));
    }
    if (fixRes.ok) {
      const fixData = await fixRes.json();
      fixData.forEach((f: any) => fixtureMap.set(f.id, f));
    }

    let gamelog: GamelogEntry[] = [];
    let historyFetched = false;

    if (histRes && histRes.ok) {
      const histData = await histRes.json();
      historyFetched = true;
      gamelog = (histData.history ?? []).map((h: any) => {
        const dbEntry =
          statsMap.get(h.fixture) ?? statsMap.get(h.round * 1000 + (dbPlayer.fpl_id ?? 0));
        const opponent = teamMap.get(h.opponent_team)?.short ?? 'UNK';

        let result = '';
        if (h.team_h_score !== null && h.team_a_score !== null) {
          const isWin = h.was_home
            ? h.team_h_score > h.team_a_score
            : h.team_a_score > h.team_h_score;
          const isLoss = h.was_home
            ? h.team_h_score < h.team_a_score
            : h.team_a_score < h.team_h_score;
          result = `${isWin ? 'W' : isLoss ? 'L' : 'D'} ${h.team_h_score}-${h.team_a_score}`;
        }

        return {
          gameweek: h.round,
          opponent: h.was_home ? `${opponent} (H)` : `${opponent} (A)`,
          result,
          date: h.kickoff_time,
          isDNP: h.minutes === 0,
          fantasy_points: dbEntry ? Number(dbEntry.fantasy_points) : 0,
          match_rating: dbEntry ? Number(dbEntry.match_rating) : null,
          stats: dbEntry ? dbEntry.stats : { minutes_played: h.minutes, goals: 0, assists: 0 },
        };
      });
    }

    if (!historyFetched) {
      gamelog = stats.map((s) => {
        const mid = Number(s.match_id);
        const f = fixtureMap.get(mid);
        let opponent = 'Unknown';
        let result = '';
        let isHome = false;

        if (f) {
          isHome = f.team_h === dbPlayer.pl_team_id;
          const oppId = isHome ? f.team_a : f.team_h;
          opponent = teamMap.get(oppId)?.short ?? 'UNK';
          if (f.finished) {
            const isWin = isHome ? f.team_h_score > f.team_a_score : f.team_a_score > f.team_h_score;
            const isLoss = isHome
              ? f.team_h_score < f.team_a_score
              : f.team_a_score < f.team_h_score;
            result = `${isWin ? 'W' : isLoss ? 'L' : 'D'} ${f.team_h_score}-${f.team_a_score}`;
          }
        } else if (mid > 1000) {
          // Synthetic match id — a DNP row with no real fixture attached.
          const gwFixtures = Array.from(fixtureMap.values()).filter(
            (fix) =>
              fix.event === s.gameweek &&
              (fix.team_h === dbPlayer.pl_team_id || fix.team_a === dbPlayer.pl_team_id),
          );
          if (gwFixtures.length > 0) {
            isHome = gwFixtures[0].team_h === dbPlayer.pl_team_id;
            const oppId = isHome ? gwFixtures[0].team_a : gwFixtures[0].team_h;
            opponent = teamMap.get(oppId)?.short ?? 'UNK';
          }
        }

        return {
          gameweek: s.gameweek,
          opponent: opponent !== 'Unknown' ? `${opponent} (${isHome ? 'H' : 'A'})` : opponent,
          result,
          isDNP: Number(s.stats?.minutes_played ?? 0) <= 0,
          fantasy_points: Number(s.fantasy_points),
          match_rating: s.match_rating != null ? Number(s.match_rating) : null,
          stats: s.stats,
        };
      });
    }

    gamelog.sort((a, b) => b.gameweek - a.gameweek);
    return { gamelog: withPositionScores(gamelog), history, season: season.targetSeason };
  } catch (err) {
    console.error('Player game log enrichment failed, falling back to DB rows', err);
    return { gamelog: buildDbFallbackLog(), history, season: season.targetSeason };
  }
}
