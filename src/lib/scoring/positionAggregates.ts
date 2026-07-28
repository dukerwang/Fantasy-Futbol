/**
 * Per-position season aggregates — the single definition of "points scored
 * AT a position".
 *
 * A player's appearance counts once under their primary position at the
 * points it was actually scored for, and once under each secondary position
 * at points re-scored under that position's weights. That re-scoring is what
 * makes the number comparable: a right winger's output evaluated as a striker
 * is not the same output, and ranking him among strikers on his winger total
 * puts him above strikers who outscored him in the role.
 *
 * Both the stats leaderboard and the positional ranks on the player card read
 * from here, so the "ST #2" pill and the striker table can never disagree.
 */

import { calculateMatchRating } from './matchRating';
import type { GranularPosition } from '@/types';

/**
 * Appearances below this are excluded — cameos distort per-90 comparisons and
 * are what the leaderboard's default "Meaningful Minutes" filter drops.
 * Ranks are computed on this threshold so the pill matches the default view.
 */
export const MEANINGFUL_MINUTES = 15;

export interface PositionAggregate {
  gp: number;
  total_points: number;
  avg_rating: number;
  total_minutes: number;
}

/** playerId → position → aggregate */
export type PositionAggregateMap = Record<string, Record<string, PositionAggregate>>;

export interface PositionRank {
  position: string;
  rank: number;
}

export interface AggregatablePlayer {
  id: string;
  primary_position: string | null;
  secondary_positions: string[] | null;
}

export interface AggregatableStatRow {
  player_id: string;
  match_rating: number | null;
  fantasy_points: number | null;
  stats: { minutes_played?: number } | null;
}

type RefStatsMap = Parameters<typeof calculateMatchRating>[2];

export function buildPositionAggregates(
  rows: AggregatableStatRow[],
  players: Map<string, AggregatablePlayer>,
  refStats: RefStatsMap,
  minMinutes: number,
): PositionAggregateMap {
  const acc = new Map<string, Map<string, { gp: number; pts: number; sumR: number; mins: number }>>();

  for (const r of rows) {
    const minutes = Number(r.stats?.minutes_played ?? 0);
    if (minutes <= 0) continue;
    if (minutes < minMinutes) continue;

    const p = players.get(r.player_id);
    if (!p) continue;

    let byPosition = acc.get(r.player_id);
    if (!byPosition) {
      byPosition = new Map();
      acc.set(r.player_id, byPosition);
    }

    const primPos = p.primary_position ? String(p.primary_position).toUpperCase() : '';
    if (primPos) {
      let primAcc = byPosition.get(primPos);
      if (!primAcc) {
        primAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
        byPosition.set(primPos, primAcc);
      }
      primAcc.gp += 1;
      primAcc.pts += Number(r.fantasy_points ?? 0);
      primAcc.sumR += Number(r.match_rating ?? 0);
      primAcc.mins += minutes;
    }

    for (const secPos of p.secondary_positions ?? []) {
      const posKey = String(secPos).toUpperCase();
      if (!posKey || posKey === primPos) continue;

      let secAcc = byPosition.get(posKey);
      if (!secAcc) {
        secAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
        byPosition.set(posKey, secAcc);
      }

      // Same appearance, evaluated under the secondary position's weights.
      const rescored = calculateMatchRating(
        r.stats as never,
        posKey as GranularPosition,
        refStats,
        primPos as GranularPosition,
      );

      secAcc.gp += 1;
      secAcc.pts += rescored.fantasyPoints;
      secAcc.sumR += rescored.rating;
      secAcc.mins += minutes;
    }
  }

  const result: PositionAggregateMap = {};
  for (const [pid, byPosition] of acc) {
    result[pid] = {};
    for (const [pos, ex] of byPosition) {
      result[pid][pos] = {
        gp: ex.gp,
        total_points: ex.pts,
        avg_rating: ex.gp > 0 ? ex.sumR / ex.gp : 0,
        total_minutes: ex.mins,
      };
    }
  }
  return result;
}

/**
 * Rank every position pool by points scored at that position, using SQL
 * RANK() semantics (ties share a rank, the next rank skips the gap) so the
 * numbers read the same as the overall_rank beside them.
 */
export function rankPositionAggregates(agg: PositionAggregateMap): Map<string, PositionRank[]> {
  const pools = new Map<string, { playerId: string; points: number }[]>();

  for (const [playerId, byPosition] of Object.entries(agg)) {
    for (const [position, stat] of Object.entries(byPosition)) {
      let pool = pools.get(position);
      if (!pool) {
        pool = [];
        pools.set(position, pool);
      }
      pool.push({ playerId, points: stat.total_points });
    }
  }

  const ranks = new Map<string, PositionRank[]>();

  for (const [position, pool] of pools) {
    pool.sort((a, b) => b.points - a.points);

    let lastPoints = Number.NaN;
    let lastRank = 0;

    pool.forEach((entry, index) => {
      const rank = entry.points === lastPoints ? lastRank : index + 1;
      lastPoints = entry.points;
      lastRank = rank;

      const existing = ranks.get(entry.playerId);
      if (existing) {
        existing.push({ position, rank });
      } else {
        ranks.set(entry.playerId, [{ position, rank }]);
      }
    });
  }

  return ranks;
}
