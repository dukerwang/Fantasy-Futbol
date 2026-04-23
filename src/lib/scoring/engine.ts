/**
 * Fantasy Futbol — Scoring Engine
 *
 * This module delegates to the Match Rating Engine (matchRating.ts) for all
 * new scoring calculations. Legacy functions are preserved for backward
 * compatibility during the migration from API-Football to FPL-based ratings.
 */

import type { GranularPosition, RawStats } from '@/types';

// ── Re-exports from the Match Rating Engine ─────────────────────────────
export {
  calculateMatchRating,
  getPositionGroup,
  POSITION_WEIGHTS,
  DEFAULT_REFERENCE_STATS,
} from './matchRating';

export type { MatchRating, RatingBreakdownItem } from '@/types';

// ── Team Points (updated to use match rating) ───────────────────────────

import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from './matchRating';
import type { ReferenceStats } from '@/types';

/**
 * Calculate total fantasy points for a team lineup in a gameweek.
 * Uses the new match-rating-based scoring.
 */
export function calculateTeamPoints(
  players: { stats: RawStats; position: GranularPosition }[],
  refStats: Record<GranularPosition | string, ReferenceStats> = DEFAULT_REFERENCE_STATS,
): number {
  return players.reduce((total, p) => {
    const { fantasyPoints } = calculateMatchRating(p.stats, p.position, refStats as any);
    return total + fantasyPoints;
  }, 0);
}

// ── Legacy: Map FPL live stats to RawStats ──────────────────────────────

import type { FplLivePlayerStats } from '@/types';

/**
 * Map an FPL live endpoint player stats object to our RawStats format.
 * Replaces the old mapApiStatsToRawStats (API-Football).
 */
export function mapFplLiveToRawStats(
  fplStats: FplLivePlayerStats['stats'],
): RawStats {
  return {
    minutes_played: fplStats.minutes,
    goals: fplStats.goals_scored,
    assists: fplStats.assists,
    shots_total: 0,   // not available per-match from FPL live
    shots_on_target: 0,
    passes_total: 0,
    passes_accurate: 0,
    pass_completion_pct: 0,
    key_passes: 0,
    big_chances_created: 0,
    dribbles_attempted: 0,
    dribbles_successful: 0,
    tackles_total: 0,
    tackles_won: 0,
    interceptions: 0,
    clearances: 0,
    blocks: 0,
    saves: fplStats.saves,
    goals_conceded: fplStats.goals_conceded,
    penalty_saves: fplStats.penalties_saved,
    yellow_cards: fplStats.yellow_cards,
    red_cards: fplStats.red_cards,
    own_goals: fplStats.own_goals,
    penalties_missed: fplStats.penalties_missed,
    clean_sheet: fplStats.clean_sheets > 0,
    // FPL live metrics (for match rating engine)
    bps: fplStats.bps,
    influence: parseFloat(fplStats.influence) || 0,
    creativity: parseFloat(fplStats.creativity) || 0,
    threat: parseFloat(fplStats.threat) || 0,
    ict_index: parseFloat(fplStats.ict_index) || 0,
    expected_goals: parseFloat(fplStats.expected_goals) || 0,
    expected_assists: parseFloat(fplStats.expected_assists) || 0,
    expected_goals_conceded: parseFloat(fplStats.expected_goals_conceded) || 0,
  };
}

/**
 * Extract a specific stat value from FPL's 'explain' stats array.
 */
export function getFplExplainStat(explainStats: { identifier: string; value: number }[], identifier: string): number {
  return explainStats.find((s) => s.identifier === identifier)?.value ?? 0;
}
