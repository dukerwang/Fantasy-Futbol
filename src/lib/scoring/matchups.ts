import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from './engine';
import { featExcessFor } from './matchRating';
import { buildPerformanceGroups, type PerfGroup } from './perfBand';
import { BENCH_DEPTH_BONUS } from '@/types';
import type { GranularPosition, RawStats, ReferenceStats, RatingComponent } from '@/types';
import type { createAdminClient } from '@/lib/supabase/admin';

export type RefStatsMap = Record<string, ReferenceStats>;

/**
 * Map of which positions can fill which slots.
 * Currently strict: each slot only accepts its own position type.
 */
export const POSITION_FLEX_MAP = {
  GK: ['GK'], CB: ['CB'], LB: ['LB'], RB: ['RB'],
  LWB: ['LWB'], RWB: ['RWB'],
  DM: ['DM'], CM: ['CM'],
  AM: ['AM'], LW: ['LW'], RW: ['RW'], ST: ['ST'],
} satisfies Record<string, string[]>;

export interface PlayerScoreRecord {
  /**
   * Each fixture the player appeared in during this gameweek.
   *
   *   minutes        — fixture-allocated minutes
   *   fantasyPoints  — pre-computed (primary-position-based) value from
   *                    `player_stats.fantasy_points`. Used for the LIVE
   *                    scoreboard and for the bench depth bonus, both of
   *                    which are intentionally primary-position scored.
   *   stats          — raw RawStats JSON for the fixture. Used to re-score
   *                    starters and auto-subs at the slot they actually
   *                    played in (role-aware), only when the GW is finished.
   */
  fixtures: { minutes: number; fantasyPoints: number; stats: RawStats | null }[];
}

/**
 * Re-score one fixture under a given lineup slot. Used for role-aware scoring
 * of starters (at their slot) and auto-subs (at the slot they're filling) once
 * the GW is finished. Returns 0 when stats are unavailable so we can fall back
 * to stored points without exploding.
 */
function rateAtSlot(
  stats: RawStats | null,
  slot: string,
  refStats: Record<string, ReferenceStats>,
  primaryPosition?: string,
): number {
  if (!stats) return 0;
  if (!(stats.minutes_played > 0)) return 0;
  const { fantasyPoints } = calculateMatchRating(
    stats,
    slot as GranularPosition,
    refStats as Record<GranularPosition, ReferenceStats>,
    primaryPosition as GranularPosition,
  );
  return fantasyPoints;
}

export type SlotAppearance = { points: number; rating: number | null };

export type MatchupPlayerDetail = {
  points: number;
  rating?: number | null;
  stats?: RawStats;
  /**
   * The banded block stored by the sync at the player's PRIMARY position
   * (migration 140). Usable only when the slot he was fielded in IS that
   * primary; any other slot has different weights and a different group order,
   * so it has to be rebuilt.
   */
  perf?: PerfGroup[] | null;
  /** The primary position the stored `perf` describes. */
  primaryPosition?: string | null;
  /**
   * Points/rating at each lineup slot this player might fill. Primary-position
   * stays on `points` / `rating` so the bench depth bonus (which is not a slot)
   * still reads the stored number.
   */
  bySlot?: Record<string, SlotAppearance>;
};

/**
 * What the matchup pitch should print for one appearance in one slot.
 *
 * Same split as the player card: points take the OOP haircut (that's what the
 * team is actually awarded); display rating is the performance under that
 * slot's weights without the post-curve squash, otherwise a great game at RB
 * reads as ~6.5 next to ~18 pts.
 *
 * When the slot IS the primary, we keep the sync-written numbers rather than
 * re-running the engine — live ICT is already imputed into the stored stats
 * JSON, and re-deriving the primary score is how this page used to drift from
 * the number already on the board.
 */
export function scoreAppearanceAtSlot(
  stats: RawStats | null | undefined,
  slot: string,
  primaryPosition: string | undefined,
  refStats: Record<string, ReferenceStats>,
  stored: SlotAppearance,
): SlotAppearance {
  if (!stats) return stored;
  if (!(stats.minutes_played > 0)) {
    return { points: 0, rating: stored.rating };
  }
  const slotPos = slot.toUpperCase();
  const primary = (primaryPosition ?? '').toUpperCase();
  if (primary && slotPos === primary) return stored;
  return {
    points: rateAtSlot(stats, slotPos, refStats, primary || undefined),
    rating: calculateMatchRating(
      stats,
      slotPos as GranularPosition,
      refStats as Record<GranularPosition, ReferenceStats>,
    ).rating,
  };
}

/**
 * Annotate a matchup's detailMap so chips / breakdown / match report all
 * read the score at the slot the player was actually fielded in, not the
 * stored primary-position number.
 *
 * Bench players keep their stored primary on `points` (bench bonus is not a
 * slot). Starters have `points` overwritten to the slot score so any caller
 * that still keys by player_id — live header, match report — agrees with the
 * chip. Auto-subs look up `bySlot[filledSlot]` instead.
 */
export function attachLineupSlotScores(
  detailMap: Record<string, MatchupPlayerDetail>,
  lineups: Array<{
    starters?: { player_id: string; slot: string }[];
    bench?: { player_id: string; slot?: string }[];
  } | null>,
  playerPrimary: Map<string, string | undefined> | Record<string, string | undefined>,
  refStats: Record<string, ReferenceStats>,
): void {
  const primaryOf = (id: string) =>
    playerPrimary instanceof Map ? playerPrimary.get(id) : playerPrimary[id];

  for (const lineup of lineups) {
    if (!lineup) continue;
    const slots = [...new Set((lineup.starters ?? []).map((s) => s.slot).filter(Boolean))];
    const ids = [
      ...(lineup.starters ?? []).map((s) => s.player_id),
      ...((lineup.bench ?? []) as { player_id: string }[]).map((b) => b.player_id),
    ].filter(Boolean);

    for (const id of ids) {
      const d = detailMap[id];
      if (!d) continue;
      const stored: SlotAppearance = { points: d.points, rating: d.rating ?? null };
      d.bySlot ??= {};
      for (const slot of slots) {
        d.bySlot[slot] = scoreAppearanceAtSlot(
          (d.stats as RawStats | null) ?? null,
          slot,
          primaryOf(id),
          refStats,
          stored,
        );
      }
    }

    for (const s of lineup.starters ?? []) {
      const d = detailMap[s.player_id];
      const slotted = d?.bySlot?.[s.slot];
      if (!d || !slotted) continue;
      d.points = slotted.points;
      d.rating = slotted.rating;
    }
  }
}

/**
 * The performance block for every starter in a matchup, keyed by player id.
 *
 * SCORED AT THE SLOT HE WAS FIELDED IN, not his primary position — the same
 * rule the chips and the breakdown already follow. Szoboszlai at RB is not
 * his AM game, and the block has to explain the points on the row beside it.
 *
 * Bench players are skipped: the bench depth bonus is not a slot, so there is
 * no position to grade a bench appearance under, and a block explaining a
 * performance that contributed a flat percentage would mislead.
 *
 * Runs on the server. The output is already banded and carries no scores —
 * see the disclosure rule in src/lib/scoring/perfBand.ts.
 */
export function buildLineupPerformance(
  detailMap: Record<string, MatchupPlayerDetail>,
  lineups: Array<{ starters?: { player_id: string; slot: string }[] } | null>,
  refStats: Record<string, ReferenceStats>,
): Record<string, PerfGroup[]> {
  const out: Record<string, PerfGroup[]> = {};
  for (const lineup of lineups) {
    for (const s of lineup?.starters ?? []) {
      const d = detailMap[s.player_id];
      const stats = d?.stats;
      if (!stats || !(stats.minutes_played > 0)) continue;
      const slot = String(s.slot ?? '').toUpperCase() as GranularPosition;
      if (!slot) continue;
      // Fielded at his own position: the sync already banded this exact
      // appearance under these exact weights. Use it, so the explanation comes
      // from the engine that scored the points rather than today's.
      if (d.perf?.length && String(d.primaryPosition ?? '').toUpperCase() === slot) {
        out[s.player_id] = d.perf;
        continue;
      }
      const { breakdown } = calculateMatchRating(
        stats,
        slot,
        refStats as Record<GranularPosition, ReferenceStats>,
      );
      if (!breakdown.length) continue;
      out[s.player_id] = buildPerformanceGroups(
        breakdown,
        slot,
        stats,
        featExcessFor(stats, slot),
      );
    }
  }
  return out;
}

/**
 * What the scorer actually did, for surfaces that have to explain a result
 * rather than just print it.
 *
 * This is populated by `calculateTeamScore` itself rather than recomputed by
 * the caller, and that is the whole point: auto-sub eligibility is strict
 * exact-position matching in a fixed bench order, and any second
 * implementation of it would eventually disagree with the score it is meant
 * to be explaining.
 */
export interface TeamScoreDetail {
  /** Starters who recorded zero minutes across every fixture. */
  blanked: { playerId: string; slot: string; covered: boolean }[];
  /** Auto-subs that fired, with the slot filled and the points earned there. */
  subs: { inId: string; outId: string; slot: string; points: number }[];
  /** Bench players who played but weren't needed, and their 25% credit. */
  benchBonus: { playerId: string; credit: number }[];
  /** Total bench depth bonus added to the score. */
  benchBonusTotal: number;
  /**
   * Starters taking the out-of-position penalty — a midfield or attacking
   * primary fielded in a defensive slot (§4 of the guide).
   */
  outOfPosition: { playerId: string; slot: string }[];
}

/** An empty detail, so callers can allocate one without repeating the shape. */
export function emptyTeamScoreDetail(): TeamScoreDetail {
  return { blanked: [], subs: [], benchBonus: [], benchBonusTotal: 0, outOfPosition: [] };
}

export interface ResolvedStarter {
  player_id: string;
  slot: string;
  isSubIn: boolean;
}

export interface ResolvedBenchEntry {
  player_id: string;
  slot?: string;
  isSubOut: boolean;
}

/**
 * The lineup as it actually played, not as it was submitted: a starter who
 * blanked and got covered is replaced by the sub who filled his slot, and the
 * bench line shows that blanked starter in the sub's old spot.
 *
 * Driven entirely by `detail.subs` — the same list `calculateTeamScore`
 * populated while computing the score being displayed — so anything that
 * needs to know "who actually earned these points" (the pitch's sub arrows,
 * the match report's star-of-the-match search) reads the identical answer
 * rather than re-deriving eligibility itself.
 */
export function applySubsToLineup(
  lineup: { starters?: { player_id: string; slot: string }[]; bench?: { player_id: string; slot?: string }[] } | null | undefined,
  detail: TeamScoreDetail | undefined,
): { starters: ResolvedStarter[]; bench: ResolvedBenchEntry[] } {
  if (!lineup) return { starters: [], bench: [] };

  const subsByOutId = new Map((detail?.subs ?? []).map((s) => [s.outId, s]));
  const subsByInId = new Map((detail?.subs ?? []).map((s) => [s.inId, s]));

  const starters: ResolvedStarter[] = (lineup.starters ?? []).map((s) => {
    const sub = subsByOutId.get(s.player_id);
    if (sub) return { player_id: sub.inId, slot: s.slot, isSubIn: true };
    return { player_id: s.player_id, slot: s.slot, isSubIn: false };
  });

  const bench: ResolvedBenchEntry[] = (lineup.bench ?? []).map((b) => {
    const sub = subsByInId.get(b.player_id);
    if (sub) return { player_id: sub.outId, slot: b.slot, isSubOut: true };
    return { player_id: b.player_id, slot: b.slot, isSubOut: false };
  });

  return { starters, bench };
}

const DEFENSIVE_SLOTS = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_OR_ATT = ['DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

/**
 * Resolve a single team's lineup score with auto-subs and bench bonus.
 *
 * Role-aware scoring (Phase 2):
 *   - When `finished === true`, starters and auto-subs are re-scored at the
 *     slot they actually filled in this matchup. A bench RB subbed into LB
 *     is scored under LB weights for this matchup only — `player_stats`
 *     stays primary-position-based so the player browser / PPG / rankings
 *     don't drift league-by-league.
 *   - During live (`finished === false`), the stored primary-position points
 *     drive the scoreboard. The UI surfaces this as "approximate, locks at
 *     GW finish".
 *   - Bench depth bonus (BENCH_DEPTH_BONUS) always uses stored points, since bench players
 *     didn't play any slot.
 *
 * @param lineup The team's lineup object (starters, bench)
 * @param playerRecord Map of player_id to their match minutes / points / stats
 * @param playerPositions Map of player_id to their allowed positions
 * @param playerPlTeamId Map of player_id to their Premier League team ID
 * @param refStats Reference stats for the rating engine
 * @param finished Whether the entire gameweek is considered finished
 * @param finishedPlTeamIds Set of Premier League team IDs whose matches are finished
 */
export function calculateTeamScore(
  lineup: any,
  playerRecord: Map<string, PlayerScoreRecord>,
  playerPositions: Map<string, string[]>,
  playerPlTeamId: Map<string, number>,
  refStats: Record<string, ReferenceStats>,
  finished: boolean,
  finishedPlTeamIds: Set<number>,
  /**
   * Optional out-param. When supplied it is filled with what the scorer did —
   * which starters blanked, which subs fired, what the bench bonus paid. Every
   * existing caller passes seven arguments and is unaffected.
   */
  detail?: TeamScoreDetail
): number {
  if (!lineup) return 0;

  let score = 0;
  const benchEntries: { player_id: string; slot: string }[] = lineup.bench ?? [];
  const benchIds = benchEntries.map((b: any) => b.player_id);
  const starters: { player_id: string; slot: string }[] = lineup.starters ?? [];

  const usedBenchIds = new Set<string>();

  /** Sum pre-computed (primary-position) fantasy points across all fixtures. */
  function getStoredPoints(playerId: string): number {
    const record = playerRecord.get(playerId);
    if (!record) return 0;
    return record.fixtures.reduce((sum, fix) => sum + (fix.minutes > 0 ? fix.fantasyPoints : 0), 0);
  }

  /**
   * Sum points across fixtures, re-scoring each at the given slot when the GW
   * is finished AND stats are present. Falls back to stored fantasyPoints
   * otherwise — this keeps the live scoreboard stable while still allowing the
   * final score to reflect the slot the player actually filled.
   */
  function getSlotPoints(playerId: string, slot: string): number {
    const record = playerRecord.get(playerId);
    if (!record) return 0;
    const allowed = playerPositions.get(playerId) ?? [];
    const primaryPosition = allowed[0];
    let total = 0;
    for (const fix of record.fixtures) {
      if (fix.minutes <= 0) continue;
      let points = 0;
      if (fix.stats) {
        points = rateAtSlot(fix.stats, slot, refStats, primaryPosition);
      } else {
        points = fix.fantasyPoints;
        const isMidOrAtt = ['DM', 'CM', 'AM', 'LW', 'RW', 'ST'].includes(primaryPosition || '');
        const isDefSlot = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(slot);
        if (primaryPosition && isMidOrAtt && isDefSlot) {
          points = points * 0.80;
        }
      }
      total += points;
    }
    return total;
  }

  // 1. Starters & Auto-Subs (role-aware once finished=true)
  for (const starter of starters) {
    const record = playerRecord.get(starter.player_id);
    const totalMinutes = record?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;

    if (totalMinutes > 0) {
      score += getSlotPoints(starter.player_id, starter.slot);
      if (detail) {
        const primary = (playerPositions.get(starter.player_id) ?? [])[0];
        if (primary && MID_OR_ATT.includes(primary) && DEFENSIVE_SLOTS.includes(starter.slot)) {
          detail.outOfPosition.push({ playerId: starter.player_id, slot: starter.slot });
        }
      }
    } else {
      // Auto-sub: only fire if this player's PL match is confirmed finished
      const plTeamId = playerPlTeamId.get(starter.player_id);
      const fixtureFinished = finished || (plTeamId != null && finishedPlTeamIds.has(plTeamId));

      let covered = false;

      if (fixtureFinished) {
        // SAFETY: lineup slots are always one of the 12 GranularPosition values, never an arbitrary string.
        const slotAllowedPos = POSITION_FLEX_MAP[starter.slot as GranularPosition] ?? [];

        for (const benchId of benchIds) {
          if (usedBenchIds.has(benchId)) continue;

          const benchRecord = playerRecord.get(benchId);
          const benchMinutes = benchRecord?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;
          if (benchMinutes === 0) continue;

          const subPositions = playerPositions.get(benchId) ?? [];
          const canPlaySlot = subPositions.some((pos) => slotAllowedPos.includes(pos));

          if (canPlaySlot) {
            // Auto-sub fills the absent starter's slot, so we rate the sub at
            // THAT slot (not the sub's own primary position).
            const subPoints = getSlotPoints(benchId, starter.slot);
            score += subPoints;
            usedBenchIds.add(benchId);
            covered = true;
            detail?.subs.push({
              inId: benchId,
              outId: starter.player_id,
              slot: starter.slot,
              points: Math.round(subPoints * 100) / 100,
            });
            break;
          }
        }
      }

      detail?.blanked.push({ playerId: starter.player_id, slot: starter.slot, covered });
    }
  }

  // 2. Bench depth bonus (BENCH_DEPTH_BONUS of unused bench players who played).
  //    Bench players didn't fill any slot, so we credit them at their
  //    primary-position points (i.e., stored fantasyPoints, unchanged from v1).
  for (const benchId of benchIds) {
    if (!usedBenchIds.has(benchId)) {
      const record = playerRecord.get(benchId);
      const totalMinutes = record?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;

      if (record && totalMinutes > 0) {
        const benchPlayerTotal = getStoredPoints(benchId);
        if (benchPlayerTotal > 0) {
          const credit = benchPlayerTotal * BENCH_DEPTH_BONUS;
          score += credit;
          if (detail) {
            detail.benchBonus.push({ playerId: benchId, credit: Math.round(credit * 100) / 100 });
            detail.benchBonusTotal =
              Math.round((detail.benchBonusTotal + credit) * 100) / 100;
          }
        }
      }
    }
  }

  return Math.round(score * 100) / 100;
}

/**
 * Load reference stats (median/stddev) from the database for dynamic scoring.
 * Falls back to hardcoded defaults if DB fetch fails.
 */
export async function loadReferenceStats(
  admin: ReturnType<typeof createAdminClient>,
  season: string
): Promise<RefStatsMap> {
  const { data, error } = await admin
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', season);

  if (error || !data || data.length === 0) {
    return DEFAULT_REFERENCE_STATS as unknown as RefStatsMap;
  }

  const ref: RefStatsMap = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  for (const row of data as { position_group: string; component: string; median: number; stddev: number }[]) {
    const pos = row.position_group;
    const comp = row.component as RatingComponent;
    if (ref[pos] && (ref[pos] as any)[comp]) {
      (ref[pos] as any)[comp] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return ref;
}
