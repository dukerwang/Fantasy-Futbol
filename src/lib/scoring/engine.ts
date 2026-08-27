/**
 * Gaffa — Scoring Engine
 *
 * This module delegates to the Match Rating Engine (matchRating.ts) for all
 * new scoring calculations. Legacy functions are preserved for backward
 * compatibility during the migration from API-Football to FPL-based ratings.
 */

import type { RawStats } from '@/types';

// ── Re-exports from the Match Rating Engine ─────────────────────────────
export {
  calculateMatchRating,
  DEFAULT_REFERENCE_STATS,
} from './matchRating';

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
    shots_on_target: 0,   // not available per-match from FPL live
    key_passes: 0,
    tackles_total: 0,
    tackles_won: 0,
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
    // FPL granular defensive stats (25/26+)
    fpl_tackles: fplStats.tackles ?? 0,
    fpl_cbi: fplStats.clearances_blocks_interceptions ?? 0,
    fpl_recoveries: fplStats.recoveries ?? 0,
    fpl_def_contrib: fplStats.defensive_contribution ?? 0,
  };
}


