import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from './engine';
import type { GranularPosition, ReferenceStats, RatingComponent } from '@/types';
import type { createAdminClient } from '@/lib/supabase/admin';

export type RefStatsMap = Record<string, ReferenceStats>;

/** 
 * Map of which positions can fill which slots. 
 * Currently strict: each slot only accepts its own position type.
 */
export const POSITION_FLEX_MAP: Record<string, string[]> = {
  GK: ['GK'], CB: ['CB'], LB: ['LB'], RB: ['RB'],
  DM: ['DM'], CM: ['CM'], LM: ['LM'], RM: ['RM'],
  AM: ['AM'], LW: ['LW'], RW: ['RW'], ST: ['ST'],
};

export interface PlayerScoreRecord {
  fixtures: { minutes: number; statsJson: any }[];
}

/**
 * Resolve a single team's lineup score with auto-subs and bench bonus.
 * 
 * @param lineup The team's lineup object (starters, bench)
 * @param playerRecord Map of player_id to their match minutes and stats
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
  const starters: { player_id: string; slot: GranularPosition }[] = lineup.starters ?? [];

  const usedBenchIds = new Set<string>();

  /** Helper to score a single player in a specific slot */
  function scorePlayerInSlot(playerId: string, slot: GranularPosition): number {
    const record = playerRecord.get(playerId);
    if (!record) return 0;

    let playerTotal = 0;
    for (const fix of record.fixtures) {
      if (fix.minutes === 0 || !fix.statsJson) continue;
      const { fantasyPoints } = calculateMatchRating(fix.statsJson, slot, refStats as any);
      playerTotal += fantasyPoints;
    }
    return playerTotal;
  }

  // 1. Starters & Auto-Subs
  for (const starter of starters) {
    const record = playerRecord.get(starter.player_id);
    const totalMinutes = record?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;

    if (totalMinutes > 0) {
      // Starter played at least one match — score using their actual lineup slot
      score += scorePlayerInSlot(starter.player_id, starter.slot);
    } else {
      // Auto-sub logic: only trigger if the player's match is confirmed finished
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
            score += scorePlayerInSlot(benchId, starter.slot);
            usedBenchIds.add(benchId);
            break;
          }
        }
      }
    }
  }

  // 2. Bench depth bonus (20% of unused bench players who played)
  for (const benchId of benchIds) {
    if (!usedBenchIds.has(benchId)) {
      const record = playerRecord.get(benchId);
      const totalMinutes = record?.fixtures.reduce((s, f) => s + f.minutes, 0) ?? 0;

      if (record && totalMinutes > 0) {
        // Score bench player in a neutral slot matching their primary position
        const primaryPos = (playerPositions.get(benchId)?.[0] ?? 'CM') as GranularPosition;
        
        let benchPlayerTotal = 0;
        for (const fix of record.fixtures) {
          if (fix.minutes > 0 && fix.statsJson) {
            const { fantasyPoints } = calculateMatchRating(fix.statsJson, primaryPos, refStats as any);
            benchPlayerTotal += fantasyPoints;
          }
        }

        if (benchPlayerTotal > 0) {
          score += benchPlayerTotal * 0.20;
        }
      }
    }
  }

  return Math.round(score * 10) / 10;
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
