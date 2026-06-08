import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from './engine';
import type { GranularPosition, RawStats, ReferenceStats, RatingComponent } from '@/types';
import type { createAdminClient } from '@/lib/supabase/admin';

export type RefStatsMap = Record<string, ReferenceStats>;

/**
 * Map of which positions can fill which slots.
 * Currently strict: each slot only accepts its own position type.
 */
export const POSITION_FLEX_MAP: Record<string, string[]> = {
  GK: ['GK'], CB: ['CB'], LB: ['LB'], RB: ['RB'],
  LWB: ['LWB'], RWB: ['RWB'],
  DM: ['DM'], CM: ['CM'],
  AM: ['AM'], LW: ['LW'], RW: ['RW'], ST: ['ST'],
};

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
 *   - Bench depth bonus (20%) always uses stored points, since bench players
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
  finishedPlTeamIds: Set<number>
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
    } else {
      // Auto-sub: only fire if this player's PL match is confirmed finished
      const plTeamId = playerPlTeamId.get(starter.player_id);
      const fixtureFinished = finished || (plTeamId != null && finishedPlTeamIds.has(plTeamId));

      if (fixtureFinished) {
        const slotAllowedPos = POSITION_FLEX_MAP[starter.slot] ?? [];

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
            score += getSlotPoints(benchId, starter.slot);
            usedBenchIds.add(benchId);
            break;
          }
        }
      }
    }
  }

  // 2. Bench depth bonus (20% of unused bench players who played).
  //    Bench players didn't fill any slot, so we credit them at their
  //    primary-position points (i.e., stored fantasyPoints, unchanged from v1).
  for (const benchId of benchIds) {
    if (!usedBenchIds.has(benchId)) {
      const record = playerRecord.get(benchId);
      const totalMinutes = record?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;

      if (record && totalMinutes > 0) {
        const benchPlayerTotal = getStoredPoints(benchId);
        if (benchPlayerTotal > 0) {
          score += benchPlayerTotal * 0.20;
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
