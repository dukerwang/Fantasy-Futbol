/**
 * Fantasy Futbol — Transfer Compensation Logic
 *
 * When a real-world player transfers OUT of the Premier League,
 * any fantasy team that owns that player receives compensation:
 *   Compensation = market_value * COMPENSATION_RATE
 *
 * The FAAB budget of the owning team is credited.
 * The player is marked inactive and dropped from the roster.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const COMPENSATION_RATE = 0.8;

export interface TransferCompensationResult {
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
  // 1. Fetch the player
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id, name, market_value')
    .eq('id', playerId)
    .single();

  if (playerError || !player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  const compensation = Math.round(player.market_value * COMPENSATION_RATE * 100) / 100;

  // 2. Mark player as inactive
  const { error: inactiveError } = await supabase
    .from('players')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', playerId);

  if (inactiveError) throw inactiveError;

  // 3. Find all roster entries for this player across all active leagues
  const { data: rosterEntries, error: rosterError } = await supabase
    .from('roster_entries')
    .select(
      `
      id, team_id,
      team:teams(id, team_name, faab_budget, league_id,
        league:leagues(status))
    `
    )
    .eq('player_id', playerId);

  if (rosterError) throw rosterError;

  const affectedTeams: TransferCompensationResult['affectedTeams'] = [];

  for (const entry of rosterEntries ?? []) {
    const team = entry.team as any;
    if (!team) continue;

    // Only process for active leagues
    if (team.league?.status !== 'active') continue;

    const previousFaab = team.faab_budget;
    const newFaab = previousFaab + compensation;

    // 4a. Credit FAAB budget
    const { error: faabError } = await supabase
      .from('teams')
      .update({ faab_budget: newFaab, updated_at: new Date().toISOString() })
      .eq('id', team.id);

    if (faabError) throw faabError;

    // 4b. Remove from roster
    const { error: dropError } = await supabase
      .from('roster_entries')
      .delete()
      .eq('id', entry.id);

    if (dropError) throw dropError;

    // 4c. Record transaction
    const { error: txError } = await supabase.from('transactions').insert({
      league_id: team.league_id,
      team_id: team.id,
      player_id: playerId,
      type: 'transfer_compensation',
      compensation_amount: compensation,
      notes: `${player.name} transferred out of PL. Compensation = £${compensation}m (${COMPENSATION_RATE * 100}% of £${player.market_value}m market value).`,
    });

    if (txError) throw txError;

    affectedTeams.push({
      teamId: team.id,
      teamName: team.team_name,
      leagueId: team.league_id,
      previousFaab,
      newFaab,
    });
  }

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
