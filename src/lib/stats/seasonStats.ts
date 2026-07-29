/**
 * Season leaderboard data loading, shared by every stats surface and by the
 * positional-rank recompute job.
 *
 * The reason this is one module: the rank shown on a player card and the order
 * of the table beside it have to be derived from the same pool and the same
 * points. They were not — the ranks came from SQL over every player in the
 * database on their raw season total, the table from TypeScript over active
 * players on re-scored per-position points — which is how a striker could read
 * "#4" while sitting 2nd in the striker table (see migration 085).
 *
 * Pool rules, applied identically to display and ranks:
 *   • archived season → every player with an archive row for it. They played
 *     that season; leaving the league afterwards does not remove them from its
 *     record, and a frozen historical rank must not shift when someone departs.
 *   • live season → active players only, which is all a live table can render.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { loadReferenceStats } from '@/lib/scoring/matchups';
import { getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import {
  MEANINGFUL_MINUTES,
  buildPositionAggregates,
  rankPositionAggregates,
  type AggregatableStatRow,
  type PositionAggregateMap,
} from '@/lib/scoring/positionAggregates';
import { calculateMatchRating } from '@/lib/scoring/matchRating';

type Admin = ReturnType<typeof createAdminClient>;
type RefStatsMap = Parameters<typeof calculateMatchRating>[2];

const PAGE_SIZE = 1000;

/** Display name + FPL seasonal team id for 2025-26 club slugs. */
const SEASON_CLUBS_2025_26: Record<string, { name: string; fplTeamId: number }> = {
  arsenal: { name: 'Arsenal', fplTeamId: 1 },
  'aston-villa': { name: 'Aston Villa', fplTeamId: 2 },
  burnley: { name: 'Burnley', fplTeamId: 3 },
  bournemouth: { name: 'Bournemouth', fplTeamId: 4 },
  brentford: { name: 'Brentford', fplTeamId: 5 },
  brighton: { name: 'Brighton', fplTeamId: 6 },
  chelsea: { name: 'Chelsea', fplTeamId: 7 },
  'crystal-palace': { name: 'Crystal Palace', fplTeamId: 8 },
  everton: { name: 'Everton', fplTeamId: 9 },
  fulham: { name: 'Fulham', fplTeamId: 10 },
  leeds: { name: 'Leeds', fplTeamId: 11 },
  liverpool: { name: 'Liverpool', fplTeamId: 12 },
  'man-city': { name: 'Man City', fplTeamId: 13 },
  'man-utd': { name: 'Man Utd', fplTeamId: 14 },
  newcastle: { name: 'Newcastle', fplTeamId: 15 },
  'nottingham-forest': { name: "Nott'm Forest", fplTeamId: 16 },
  sunderland: { name: 'Sunderland', fplTeamId: 17 },
  spurs: { name: 'Spurs', fplTeamId: 18 },
  'west-ham': { name: 'West Ham', fplTeamId: 19 },
  wolves: { name: 'Wolves', fplTeamId: 20 },
};

const CLUBS_BY_SEASON: Record<string, Record<string, { name: string; fplTeamId: number }>> = {
  '2025-26': SEASON_CLUBS_2025_26,
};

export interface SeasonStatsContext {
  season: string;
  /** True when the season has been archived, which widens the pool to departed players. */
  archived: boolean;
  /** Players in the pool, already carrying season-resolved stats and ranks. */
  players: any[];
  playerMap: Map<string, any>;
  statRows: AggregatableStatRow[];
  refStats: RefStatsMap;
}

export interface SeasonShadowMaps {
  played: PositionAggregateMap;
  all: PositionAggregateMap;
  gt45: PositionAggregateMap;
}

async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const { data } = await run(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Load the player pool, their season stat rows and the reference stats needed
 * to re-score secondary positions.
 */
export async function loadSeasonStatsContext(admin: Admin, season: string): Promise<SeasonStatsContext> {
  // The season being viewed may predate any reference stats of its own; the
  // latest calibrated season is what the rest of the app scores against.
  const refSeason = await getLatestReferenceStatsSeason(admin);

  const [archives, playersData, statRows, refStats, seasonClubs] = await Promise.all([
    fetchAllPages<any>((from, to) =>
      admin
        .from('season_player_stats_archive')
        .select('player_id, total_points, ppg, form_rating, overall_rank, position_ranks')
        .eq('season', season)
        .range(from, to),
    ),
    fetchAllPages<any>((from, to) =>
      admin
        .from('players')
        .select(FULL_PLAYER_SELECT)
        .order('total_points', { ascending: false, nullsFirst: false })
        .range(from, to) as any,
    ),
    fetchAllPages<AggregatableStatRow>((from, to) =>
      admin
        .from('player_stats')
        .select('player_id, match_rating, fantasy_points, stats')
        .eq('season', season)
        .range(from, to) as any,
    ),
    loadReferenceStats(admin, refSeason),
    fetchAllPages<{ player_id: string; club_slug: string }>((from, to) =>
      admin
        .from('player_season_clubs')
        .select('player_id, club_slug')
        .eq('season', season)
        .range(from, to) as any,
    ),
  ]);

  const archiveMap = new Map(archives.map((a) => [a.player_id, a]));
  const archived = archives.length > 0;
  const seasonClubByPlayer = new Map(seasonClubs.map((r) => [r.player_id, r.club_slug]));
  const seasonClubsMeta = CLUBS_BY_SEASON[season] ?? {};

  const players = playersData
    .filter((p) => (archived ? archiveMap.has(p.id) : p.is_active))
    .map((p) => {
      const arch = archiveMap.get(p.id);
      let pl_team = p.pl_team;
      let pl_team_id = p.pl_team_id;

      // players.pl_team is the CURRENT club. For an archived season it names
      // whoever they play for today — summer transfers, identity-bleed from a
      // bad sync, promoted clubs, the lot. Prefer the per-season club record.
      if (archived) {
        const slug = seasonClubByPlayer.get(p.id);
        const meta = slug ? seasonClubsMeta[slug] : null;
        if (meta) {
          pl_team = meta.name;
          pl_team_id = meta.fplTeamId;
        }
      }

      if (!arch) return { ...p, pl_team, pl_team_id };
      return {
        ...p,
        pl_team,
        pl_team_id,
        // A frozen season owns all of its own numbers — reading total_points or
        // ppg off players would show whatever the live season has since written.
        total_points: Number(arch.total_points),
        ppg: Number(arch.ppg),
        form_rating: Number(arch.form_rating),
        overall_rank: arch.overall_rank,
        position_ranks: arch.position_ranks,
      };
    });

  const playerMap = new Map<string, any>();
  for (const p of players) playerMap.set(p.id, p);

  return { season, archived, players, playerMap, statRows, refStats: refStats as RefStatsMap };
}

/** The three minute thresholds the leaderboard's filter switches between. */
export function buildShadowMaps(ctx: SeasonStatsContext): SeasonShadowMaps {
  const build = (minMinutes: number) =>
    buildPositionAggregates(ctx.statRows, ctx.playerMap, ctx.refStats, minMinutes);

  return {
    played: build(1),
    all: build(MEANINGFUL_MINUTES),
    gt45: build(45),
  };
}

export interface SeasonLeaderboard {
  players: any[];
  shadowMaps: SeasonShadowMaps;
  archived: boolean;
}

/** Everything GlobalStatsTable needs for a season, minus league ownership. */
export async function loadSeasonLeaderboard(admin: Admin, season: string): Promise<SeasonLeaderboard> {
  const ctx = await loadSeasonStatsContext(admin, season);

  // Live season: the ranks live on players.position_ranks, which the archive
  // branch of loadSeasonStatsContext has already overridden where applicable.
  if (!ctx.archived) {
    const { data: rankings } = await admin.from('player_rankings').select('*');
    const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
    for (const p of ctx.players) {
      const ranks = rankMap.get(p.id);
      p.overall_rank = ranks?.overall_rank;
      p.position_ranks = ranks?.position_ranks;
    }
  }

  return { players: ctx.players, shadowMaps: buildShadowMaps(ctx), archived: ctx.archived };
}

export interface RecomputeResult {
  season: string;
  archived: boolean;
  ranked_players: number;
  written: number;
}

/**
 * Recompute and persist positional ranks for a season.
 *
 * Ranks are taken from the >= 15-minute aggregate, which is the leaderboard's
 * default view, so "ST #2" means second on the striker table as it first
 * renders. Called after every live stats sync and immediately after a season
 * is archived.
 */
export async function recomputePositionRanks(admin: Admin, season: string): Promise<RecomputeResult> {
  const ctx = await loadSeasonStatsContext(admin, season);
  const aggregates = buildPositionAggregates(
    ctx.statRows,
    ctx.playerMap,
    ctx.refStats,
    MEANINGFUL_MINUTES,
  );
  const ranks = rankPositionAggregates(aggregates);

  const payload = ctx.players.map((p) => ({
    player_id: p.id,
    position_ranks: ranks.get(p.id) ?? [],
  }));

  const { data, error } = ctx.archived
    ? await admin.rpc('apply_archive_position_ranks', { p_season: season, p_payload: payload })
    : await admin.rpc('apply_player_position_ranks', { p_payload: payload });

  if (error) throw new Error(`recomputePositionRanks(${season}): ${error.message}`);

  return {
    season,
    archived: ctx.archived,
    ranked_players: ranks.size,
    written: Number(data ?? 0),
  };
}
