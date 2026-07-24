/**
 * Gaffa — Relegation Compensation Handler
 *
 * Processes end-of-season FAAB compensation for players at relegated clubs.
 * Detection is automatic: the existing sync/players route marks relegated
 * players as is_active=false when FPL sets their status to 'u'.
 * This module only handles the payout step, run by the commissioner.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { processPlayerTransferOut, COMPENSATION_RATE } from '@/lib/transfers/compensation';

interface RelegationResult {
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

interface RelegationPreview {
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
 * A "relegated player" is any `is_active=false` player still sitting on a
 * roster in this league. Membership on a roster is the guard: once processed
 * the roster entry is deleted, so a processed player can never show up twice.
 * (`pl_status` is written as an audit marker but is deliberately NOT used to
 * exclude — it's a global column, so using it as the guard meant the first
 * league processed consumed the flag for every other league.)
 */
export async function previewRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
): Promise<RelegationPreview[]> {
  const { data: relegatedPlayers, error: playersErr } = await admin
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', false);

  if (playersErr || !relegatedPlayers || relegatedPlayers.length === 0) return [];

  const playerIds = relegatedPlayers.map((p) => p.id);

  // Find which of these are on rosters in this league. `!inner` is required —
  // without it PostgREST keeps every row and merely nulls the embed, so the
  // league filter silently did nothing and other leagues' entries leaked in.
  const { data: rosterEntries } = await admin
    .from('roster_entries')
    .select('player_id, team:teams!inner(id, team_name, league_id)')
    .in('player_id', playerIds)
    .eq('team.league_id', leagueId);

  if (!rosterEntries || rosterEntries.length === 0) return [];

  const results: RelegationPreview[] = [];

  for (const player of relegatedPlayers) {
    const owned = (rosterEntries ?? []).filter((r) => r.player_id === player.id);
    if (owned.length === 0) continue;

    // Same constant the payout uses — a hardcoded rate here meant the preview
    // could quote a figure the RPC never actually paid.
    const comp = Math.round(player.market_value * COMPENSATION_RATE * 100) / 100;
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
 * For each inactive player on a fantasy roster in THIS league:
 * - Owner receives 80% of market_value as FAAB (via processPlayerTransferOut)
 * - Player removed from roster
 * - pl_status set to 'relegated' (audit marker)
 * - season_transitions record written
 *
 * Idempotent on two levels: the RPC skips any (team, player) that already has
 * a `transfer_compensation` transaction, and processing deletes the roster
 * entry, so a second run finds nothing left to select.
 */
export async function processRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
  seasonTo: string,
): Promise<RelegationResult[]> {
  // Scope to players actually rostered in this league. The previous version
  // scanned `players` globally and used pl_status as the guard, which meant a
  // batch run (kickoff-all) stamped every inactive player 'relegated' while
  // processing the first league — starving every league after it.
  const { data: leagueTeams, error: teamsErr } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  if (teamsErr) throw new Error(`Failed to load league teams: ${teamsErr.message}`);

  const teamIds = (leagueTeams ?? []).map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: entries, error: entriesErr } = await admin
    .from('roster_entries')
    .select('player_id')
    .in('team_id', teamIds)
    .not('player_id', 'is', null);
  if (entriesErr) throw new Error(`Failed to load rostered players: ${entriesErr.message}`);

  const rosteredIds = [...new Set((entries ?? []).map((e) => e.player_id))];
  if (rosteredIds.length === 0) return [];

  const { data: relegatedPlayers, error: playersErr } = await admin
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', false)
    .in('id', rosteredIds);

  if (playersErr) throw new Error(`Failed to fetch relegated players: ${playersErr.message}`);
  if (!relegatedPlayers || relegatedPlayers.length === 0) return [];

  const results: RelegationResult[] = [];

  for (const player of relegatedPlayers) {
    // The RPC pays out across every league that rosters this player — correct,
    // since the player has left the PL for all of them. But the audit trail and
    // the returned result belong to the league being kicked off, so scope them.
    const result = await processPlayerTransferOut(admin, player.id);
    const inThisLeague = result.affectedTeams.filter((t) => t.leagueId === leagueId);

    if (result.affectedTeams.length > 0) {
      await admin
        .from('players')
        .update({ pl_status: 'relegated', pl_season: seasonFrom, updated_at: new Date().toISOString() })
        .eq('id', player.id);

      // Write season_transitions record per team affected in THIS league
      const transitionRows = inThisLeague.map((t) => ({
        league_id: leagueId,
        season_from: seasonFrom,
        season_to: seasonTo,
        event_type: 'relegated',
        player_id: player.id,
        team_id: t.teamId,
        team_name: t.teamName,
        notes: `${player.name} (${player.pl_team}) relegated. €${result.compensation}m compensation paid.`,
      }));

      if (transitionRows.length > 0) {
        const { error: transErr } = await admin.from('season_transitions').insert(transitionRows);
        if (transErr) {
          console.error(`[relegation] Failed to write season_transitions for ${player.name}:`, transErr);
        }
      }

      results.push({
        playerId: player.id,
        playerName: player.name,
        club: player.pl_team,
        compensationFaab: result.compensation,
        affectedRosters: inThisLeague.map((t) => ({
          teamId: t.teamId,
          teamName: t.teamName,
          leagueId: t.leagueId,
          newFaab: t.newFaab,
        })),
      });
    } else {
      // Nothing paid out — league isn't in a payable state. Still mark the
      // player so the audit trail reflects that they've left the PL.
      await admin
        .from('players')
        .update({ pl_status: 'relegated', pl_season: seasonFrom, updated_at: new Date().toISOString() })
        .eq('id', player.id);
    }
  }

  return results;
}
