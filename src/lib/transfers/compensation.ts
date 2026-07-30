/**
 * Gaffa — Transfer Compensation Logic
 *
 * When a real-world player transfers OUT of the Premier League,
 * any fantasy team that owns that player receives compensation:
 *   Compensation = market_value * COMPENSATION_RATE
 *
 * The FAAB budget of the owning team is credited.
 * The player is marked inactive and dropped from the roster.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fallback fraction of market value refunded when a player leaves the Premier
 * League. The live value is per-league: `leagues.departure_compensation_rate`
 * (migration 069) — read it with `getDepartureCompensationRate()`. This
 * constant is only the default for callers that have no league in hand.
 *
 * The rate is a balance dial, not an implementation detail. It decides whether
 * a manager should ever keep a departed player's rights instead of taking the
 * cash: retaining is rational only when P(player returns to the PL) exceeds
 * rate / auction premium. At 1.0 no premium is high enough, and retention is
 * never the right call.
 *
 * A previous version set this to 1.0 to dodge a rounding artefact —
 * `teams.faab_budget` is an INT column and the RPC casts the payout to it, so
 * €6m at 0.8 credits €5m rather than €4.8m. That is a ±€0.5m rounding on a
 * currency denominated in millions; it is not worth distorting the economy to
 * avoid. Payouts round to the nearest whole million and that is intended.
 *
 * Lowered from 0.8 to 0.6 by migration 091. Two reasons: departure
 * compensation was the second-largest source of newly created money in the
 * league (~EUR 152m/season for six clubs), and at 0.8 the payout was
 * generous enough that releasing beat retaining in almost every case,
 * leaving the Retained List as dead weight. At 0.6, holding rights is a
 * real decision.
 *
 * Exported so the preview path can't drift from what actually gets paid.
 */
export const COMPENSATION_RATE = 0.6;

/**
 * Resolves the departure compensation rate for one league, falling back to
 * COMPENSATION_RATE if the league row or column is unreadable. Every payout
 * path should price off this rather than a literal, so the manual transfer-out
 * and the relegation sweep can never quote different figures for the same
 * event again (they previously disagreed: 0.8 inline vs 1.0 here).
 */
export async function getDepartureCompensationRate(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data } = await supabase
    .from('leagues')
    .select('departure_compensation_rate')
    .eq('id', leagueId)
    .single();

  const rate = Number(data?.departure_compensation_rate);
  return Number.isFinite(rate) ? rate : COMPENSATION_RATE;
}

interface TransferCompensationResult {
  playerId: string;
  playerName: string;
  marketValue: number;
  compensation: number;
  affectedTeams: {
    teamId: string;
    teamName: string;
    leagueId: string;
    previousFaab: number;
    newFaab: number;
    /** What this league actually paid — leagues can be on different rates. */
    compensation: number;
  }[];
}

/**
 * Process a real-world player transfer out of the PL.
 * - Marks player as inactive
 * - Finds all fantasy teams that roster this player
 * - Credits each team's FAAB budget
 * - Removes player from all rosters
 * - Records transactions
 *
 * @deprecated Superseded by the departure decision flow (src/lib/departures).
 * Nothing calls this any more and new code must not: it pays compensation
 * immediately across every league at once, which skips the manager's
 * retain-or-release choice entirely and leaves no `departure_decisions` row —
 * so the player would be silently released without ever reaching the Retained
 * List, and the per-departure idempotency key would not exist. Use
 * `recordDepartures` to open a decision and `releaseDeparture` to pay one out.
 * Kept only because the underlying RPC still exists in the database.
 */
export async function processPlayerTransferOut(
  supabase: SupabaseClient,
  playerId: string
): Promise<TransferCompensationResult> {
  // Call the atomic and idempotent database RPC
  const { data, error } = await supabase.rpc('process_player_transfer_out_rpc', {
    p_player_id: playerId,
    p_compensation_rate: COMPENSATION_RATE,
  });

  if (error) {
    throw new Error(`Failed to process player transfer out: ${error.message}`);
  }

  // Fetch player details to construct the final output object
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id, name, market_value')
    .eq('id', playerId)
    .single();

  if (playerError || !player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  interface RpcTransferTeamRow {
    team_id: string;
    team_name: string;
    league_id: string;
    previous_faab: number;
    new_faab: number;
    compensation: number;
  }

  const rows = (data as RpcTransferTeamRow[]) ?? [];

  const affectedTeams = rows.map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    leagueId: row.league_id,
    previousFaab: row.previous_faab,
    newFaab: row.new_faab,
    compensation: Number(row.compensation ?? 0),
  }));

  // Since migration 071 each league pays at its own configured rate, so there
  // is no single figure for the call. Report the first row's — callers that
  // care about a specific league must read it off that league's row. Falls back
  // to the default rate only when the RPC paid nobody (nothing to report).
  const compensation = rows.length
    ? Number(rows[0].compensation ?? 0)
    : player.market_value
      ? Math.round(player.market_value * COMPENSATION_RATE * 100) / 100
      : 0;

  return {
    playerId,
    playerName: player.name,
    marketValue: player.market_value,
    compensation,
    affectedTeams,
  };
}

/**
 * Detect players who have transferred out of the PL.
 * Compares our active players list against the current API-Football PL squad list.
 *
 * @param supabase - Supabase client (with service role for admin operations)
 * @param currentPlPlayerIds - API-Football player IDs currently in the PL
 */
export async function detectTransferredOutPlayers(
  supabase: SupabaseClient,
  currentPlPlayerIds: Set<number>
): Promise<string[]> {
  // Fetch all players we consider active
  const { data: activePlayers, error } = await supabase
    .from('players')
    .select('id, api_football_id, name')
    .eq('is_active', true)
    .not('api_football_id', 'is', null);

  if (error) throw error;

  const transferredOut: string[] = [];

  for (const player of activePlayers ?? []) {
    if (!currentPlPlayerIds.has(player.api_football_id)) {
      transferredOut.push(player.id);
    }
  }

  return transferredOut;
}
