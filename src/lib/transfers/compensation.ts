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
 * Fraction of market value refunded when a player leaves the Premier League.
 *
 * 1.0 (full market value): Transfermarkt valuations sit below what clubs
 * actually pay in real transfers, so paying "100%" of a TM figure is still
 * conservative against a real fee. It also removes a rounding artefact —
 * `teams.faab_budget` is an INT column and the RPC casts the payout to it, so
 * a fractional rate turned round market values into fractional payouts that
 * silently rounded (€6m at 0.8 credited €5m, not €4.8m). At 1.0 the payout is
 * the market value itself, which is nearly always whole.
 *
 * Exported so the preview path can't drift from what actually gets paid.
 */
export const COMPENSATION_RATE = 1.0;

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
  }[];
}

/**
 * Process a real-world player transfer out of the PL.
 * - Marks player as inactive
 * - Finds all fantasy teams that roster this player
 * - Credits each team's FAAB budget
 * - Removes player from all rosters
 * - Records transactions
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

  const compensation = player.market_value
    ? Math.round(player.market_value * COMPENSATION_RATE * 100) / 100
    : 0;

  interface RpcTransferTeamRow {
    team_id: string;
    team_name: string;
    league_id: string;
    previous_faab: number;
    new_faab: number;
  }

  const affectedTeams = (data as RpcTransferTeamRow[] ?? []).map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    leagueId: row.league_id,
    previousFaab: row.previous_faab,
    newFaab: row.new_faab,
  }));

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
