/**
 * Fantasy Futbol — Season Reset Orchestrator
 *
 * Runs the full end-of-season reset in sequence:
 * 1. Preflight validation (all GW38 matchups completed, all cups completed)
 * 2. Archive final standings
 * 3. Distribute prizes (season + cups)
 * 4. Process relegation compensation
 * 5. Reset match schedule for new season
 * 6. Reset tournaments for new season
 * 7. Advance league season metadata (current_season, status)
 * 8. Lock/unlock roster (set roster_locked appropriately)
 *
 * This is called ONCE by the admin offseason route when the commissioner confirms.
 * It is NOT a cron job — commissioner-triggered only.
 *
 * Idempotency:
 * - Gated on leagues.status !== 'offseason' (already reset = no-op)
 * - Relegation compensation gated on pl_status != 'relegated'
 * - Prize payouts are NOT idempotent — don't call twice.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { processRelegationCompensation, type RelegationResult } from './relegationHandler';
import { distributeAllPrizes, type PrizeEntry } from './prizeDistribution';

export interface PreflightResult {
  ready: boolean;
  issues: string[];
  incompleteMatchups: number;
  incompleteTournaments: { id: string; name: string }[];
}

export interface ResetResult {
  seasonFrom: string;
  seasonTo: string;
  prizesPaid: PrizeEntry[];
  totalPrizeFaab: number;
  relegationResults: RelegationResult[];
  matchupsReset: number;
  tournamentsReset: number;
  standingsArchived: number;
}

/**
 * Validates that the season is actually over before allowing reset.
 */
export async function runPreflightChecks(
  admin: SupabaseClient,
  leagueId: string,
): Promise<PreflightResult> {
  const issues: string[] = [];

  // Check all regular season matchups are completed
  const { count: incompleteMatchups } = await admin
    .from('matchups')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .neq('status', 'completed');

  if (incompleteMatchups && incompleteMatchups > 0) {
    issues.push(`${incompleteMatchups} regular season matchup(s) not yet completed.`);
  }

  // Check all tournaments are completed
  const { data: incompleteTourneys } = await admin
    .from('tournaments')
    .select('id, name')
    .eq('league_id', leagueId)
    .neq('status', 'completed');

  const incompleteTournaments = incompleteTourneys ?? [];
  if (incompleteTournaments.length > 0) {
    issues.push(`${incompleteTournaments.length} tournament(s) not yet completed: ${incompleteTournaments.map((t) => t.name).join(', ')}.`);
  }

  return {
    ready: issues.length === 0,
    issues,
    incompleteMatchups: incompleteMatchups ?? 0,
    incompleteTournaments,
  };
}

/**
 * Archives final standings into season_standings_archive.
 */
async function archiveStandings(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
): Promise<number> {
  const { data: standings, error } = await admin
    .from('league_standings')
    .select('team_id, rank, total_points')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });

  if (error || !standings) throw new Error(`Failed to fetch standings for archive: ${error?.message}`);

  const rows = standings.map((s) => ({
    league_id: leagueId,
    season: seasonFrom,
    team_id: s.team_id,
    final_rank: s.rank,
    total_points: s.total_points,
  }));

  const { error: insertErr } = await admin
    .from('season_standings_archive')
    .upsert(rows, { onConflict: 'league_id,season,team_id' });

  if (insertErr) throw new Error(`Failed to archive standings: ${insertErr.message}`);
  return rows.length;
}

/**
 * Deletes all matchups for the league (to regenerate for new season).
 * Preserves tournament matchups — those are handled separately.
 */
async function resetMatchups(
  admin: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data: deleted, error } = await admin
    .from('matchups')
    .delete()
    .eq('league_id', leagueId)
    .select('id');

  if (error) throw new Error(`Failed to reset matchups: ${error.message}`);
  return deleted?.length ?? 0;
}

/**
 * Deletes all tournaments (and their rounds/matchups via cascade) for the league.
 */
async function resetTournaments(
  admin: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data: tournaments, error: fetchErr } = await admin
    .from('tournaments')
    .select('id')
    .eq('league_id', leagueId);

  if (fetchErr) throw new Error(`Failed to fetch tournaments: ${fetchErr.message}`);
  if (!tournaments || tournaments.length === 0) return 0;

  const ids = tournaments.map((t) => t.id);

  // Delete tournament_matchups first (may not cascade automatically)
  const { data: rounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .in('tournament_id', ids);

  if (rounds && rounds.length > 0) {
    const roundIds = rounds.map((r) => r.id);
    await admin.from('tournament_matchups').delete().in('round_id', roundIds);
    await admin.from('tournament_rounds').delete().in('id', roundIds);
  }

  const { error: deleteErr } = await admin
    .from('tournaments')
    .delete()
    .in('id', ids);

  if (deleteErr) throw new Error(`Failed to delete tournaments: ${deleteErr.message}`);
  return ids.length;
}

/**
 * Resets team season stats (total_points, wins, losses, etc.) for the new season.
 * FAAB budgets are NOT reset — they are permanent dynasty currency.
 */
async function resetTeamSeasonStats(
  admin: SupabaseClient,
  leagueId: string,
): Promise<void> {
  const { error } = await admin
    .from('teams')
    .update({
      total_points: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('league_id', leagueId);

  if (error) throw new Error(`Failed to reset team stats: ${error.message}`);
}

/**
 * Main entry point — runs the full offseason reset for one league.
 *
 * Caller is responsible for:
 * - Verifying CRON_SECRET auth
 * - Calling runPreflightChecks() first and aborting if not ready
 * - Running POST /api/sync/players after this to pull in promoted club players
 */
export async function runSeasonReset(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
  seasonTo: string,
): Promise<ResetResult> {
  // Guard: only run once per season
  const { data: league } = await admin
    .from('leagues')
    .select('status, current_season')
    .eq('id', leagueId)
    .single();

  if (!league) throw new Error('League not found');
  if (league.status === 'offseason') {
    throw new Error(`League is already in offseason mode (season: ${league.current_season}). Reset already ran.`);
  }

  // Step 1: Lock rosters immediately
  await admin
    .from('leagues')
    .update({ roster_locked: true, updated_at: new Date().toISOString() })
    .eq('id', leagueId);

  // Step 2: Archive standings
  const standingsArchived = await archiveStandings(admin, leagueId, seasonFrom);

  // Step 3: Distribute prizes
  const { paid: prizesPaid, totalFaab: totalPrizeFaab } = await distributeAllPrizes(admin, leagueId, seasonFrom);

  // Step 4: Process relegation compensation
  const relegationResults = await processRelegationCompensation(admin, leagueId, seasonFrom, seasonTo);

  // Step 5: Reset matchup schedule
  const matchupsReset = await resetMatchups(admin, leagueId);

  // Step 6: Reset tournaments
  const tournamentsReset = await resetTournaments(admin, leagueId);

  // Step 7: Reset team season stats (NOT FAAB — that persists)
  await resetTeamSeasonStats(admin, leagueId);

  // Step 8: Advance league metadata
  await admin
    .from('leagues')
    .update({
      status: 'offseason',
      current_season: seasonTo,
      previous_season: seasonFrom,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leagueId);

  return {
    seasonFrom,
    seasonTo,
    prizesPaid,
    totalPrizeFaab,
    relegationResults,
    matchupsReset,
    tournamentsReset,
    standingsArchived,
  };
}
