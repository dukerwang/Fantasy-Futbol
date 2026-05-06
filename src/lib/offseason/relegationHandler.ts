/**
 * Fantasy Futbol — Relegation Compensation Handler
 *
 * Processes end-of-season FAAB compensation for players at relegated clubs.
 * Detection is automatic: the existing sync/players route marks relegated
 * players as is_active=false when FPL sets their status to 'u'.
 * This module only handles the payout step, run by the commissioner.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { processPlayerTransferOut } from '@/lib/transfers/compensation';

export interface RelegationResult {
  playerId: string;
  playerName: string;
  club: string;
  compensationFaab: number;
  affectedRosters: {
    teamId: string;
    teamName: string;
    leagueId: string;
    newFaab: number;
  }[];
}

export interface RelegationPreview {
  playerId: string;
  playerName: string;
  club: string;
  marketValue: number;
  compensationFaab: number;
  ownedBy: { teamName: string; leagueId: string }[];
}

/**
 * Returns a preview of all relegated players on fantasy rosters in a given league.
 * Used by the admin UI to show the commissioner what will happen before they confirm.
 *
 * A "relegated player" is: is_active=false AND pl_status='active' (not yet processed).
 */
export async function previewRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
): Promise<RelegationPreview[]> {
  // Find all inactive, unprocessed players
  const { data: relegatedPlayers, error: playersErr } = await admin
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', false)
    .eq('pl_status', 'active');

  if (playersErr || !relegatedPlayers || relegatedPlayers.length === 0) return [];

  const playerIds = relegatedPlayers.map((p) => p.id);

  // Find which of these are on rosters in this league
  const { data: rosterEntries } = await admin
    .from('roster_entries')
    .select('player_id, team:teams(id, team_name, league_id)')
    .in('player_id', playerIds)
    .eq('teams.league_id', leagueId);

  if (!rosterEntries || rosterEntries.length === 0) return [];

  const results: RelegationPreview[] = [];

  for (const player of relegatedPlayers) {
    const owned = (rosterEntries ?? []).filter((r) => r.player_id === player.id);
    if (owned.length === 0) continue;

    const comp = Math.round(player.market_value * 0.8 * 100) / 100;
    results.push({
      playerId: player.id,
      playerName: player.name,
      club: player.pl_team,
      marketValue: player.market_value,
      compensationFaab: comp,
      ownedBy: owned.map((r) => {
        const team = r.team as unknown as { id: string; team_name: string; league_id: string };
        return { teamName: team?.team_name ?? 'Unknown', leagueId: team?.league_id ?? '' };
      }),
    });
  }

  return results;
}

/**
 * Processes relegation compensation for all relegated players owned in a league.
 *
 * For each inactive (pl_status='active') player on a fantasy roster:
 * - Owner receives 80% of market_value as FAAB (via processPlayerTransferOut)
 * - Player removed from roster
 * - pl_status set to 'relegated' (idempotency guard)
 * - season_transitions record written
 *
 * Idempotent: pl_status='relegated' prevents double-processing.
 */
export async function processRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
  seasonTo: string,
): Promise<RelegationResult[]> {
  const { data: relegatedPlayers, error: playersErr } = await admin
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', false)
    .eq('pl_status', 'active');

  if (playersErr) throw new Error(`Failed to fetch relegated players: ${playersErr.message}`);
  if (!relegatedPlayers || relegatedPlayers.length === 0) return [];

  const results: RelegationResult[] = [];

  for (const player of relegatedPlayers) {
    // processPlayerTransferOut checks for roster entries internally — skip if free agent
    const result = await processPlayerTransferOut(admin, player.id);

    if (result.affectedTeams.length > 0) {
      // Mark player as processed so we don't double-pay
      await admin
        .from('players')
        .update({ pl_status: 'relegated', pl_season: seasonFrom, updated_at: new Date().toISOString() })
        .eq('id', player.id);

      // Write season_transitions record per team affected
      const transitionRows = result.affectedTeams.map((t) => ({
        league_id: leagueId,
        season_from: seasonFrom,
        season_to: seasonTo,
        event_type: 'relegated',
        player_id: player.id,
        team_id: t.teamId,
        team_name: t.teamName,
        notes: `${player.name} (${player.pl_team}) relegated. ${result.compensation} FAAB compensated.`,
      }));

      const { error: transErr } = await admin.from('season_transitions').insert(transitionRows);
      if (transErr) {
        console.error(`[relegation] Failed to write season_transitions for ${player.name}:`, transErr);
      }

      results.push({
        playerId: player.id,
        playerName: player.name,
        club: player.pl_team,
        compensationFaab: result.compensation,
        affectedRosters: result.affectedTeams.map((t) => ({
          teamId: t.teamId,
          teamName: t.teamName,
          leagueId: t.leagueId,
          newFaab: t.newFaab,
        })),
      });
    } else {
      // Free agent — just mark as relegated, no compensation needed
      await admin
        .from('players')
        .update({ pl_status: 'relegated', pl_season: seasonFrom, updated_at: new Date().toISOString() })
        .eq('id', player.id);
    }
  }

  return results;
}
