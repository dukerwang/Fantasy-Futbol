/**
 * Gaffa — Season Reset Orchestrator
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
import { distributeAllPrizes, type PrizeEntry } from './prizeDistribution';
import { insertMatchups } from '@/lib/schedule/insertMatchups';
import { createAllTournaments, type CreateTournamentResult } from '@/lib/tournaments/createTournaments';

interface PreflightResult {
  ready: boolean;
  issues: string[];
  incompleteMatchups: number;
  incompleteTournaments: { id: string; name: string }[];
}

interface ResetResult {
  seasonFrom: string;
  seasonTo: string;
  prizesPaid: PrizeEntry[];
  totalPrizeFaab: number;
  matchupsReset: number;
  tournamentsReset: number;
  standingsArchived: number;
  matchupsGenerated: number;
  tournamentsCreated: CreateTournamentResult[];
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
 * Archives all regular-season matchups of the completed season.
 */
async function archiveMatchups(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
): Promise<number> {
  const { data: matchups, error } = await admin
    .from('matchups')
    .select('gameweek, team_a_id, team_b_id, score_a, score_b, lineup_a, lineup_b')
    .eq('league_id', leagueId);

  if (error) throw new Error(`Failed to fetch matchups for archive: ${error.message}`);
  if (!matchups || matchups.length === 0) return 0;

  const rows = matchups.map((m) => ({
    league_id: leagueId,
    season: seasonFrom,
    gameweek: m.gameweek,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    score_a: m.score_a,
    score_b: m.score_b,
    lineup_a: m.lineup_a,
    lineup_b: m.lineup_b,
  }));

  const { error: insertErr } = await admin
    .from('season_matchups_archive')
    .upsert(rows, { onConflict: 'league_id,season,gameweek,team_a_id,team_b_id' });

  if (insertErr) throw new Error(`Failed to archive matchups: ${insertErr.message}`);
  return rows.length;
}

/**
 * Resolves cup winners of the completed season and archives them.
 */
async function archiveCupWinners(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
): Promise<number> {
  const { data: tournaments, error: fetchErr } = await admin
    .from('tournaments')
    .select('id, name, type, season')
    .eq('league_id', leagueId)
    .eq('season', seasonFrom)
    .eq('status', 'completed');

  if (fetchErr) throw new Error(`Failed to fetch tournaments for winner archive: ${fetchErr.message}`);
  if (!tournaments || tournaments.length === 0) return 0;

  const rows: any[] = [];

  for (const t of tournaments) {
    // Find the final round (highest round_number)
    const { data: finalRound, error: rErr } = await admin
      .from('tournament_rounds')
      .select('id')
      .eq('tournament_id', t.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single();

    if (rErr || !finalRound) continue;

    // Find completed matchup in that round with a winner
    const { data: matchups, error: mErr } = await admin
      .from('tournament_matchups')
      .select('winner_id')
      .eq('round_id', finalRound.id)
      .eq('status', 'completed')
      .not('winner_id', 'is', null)
      .limit(1);

    const finalMatchup = matchups?.[0];
    if (mErr || !finalMatchup?.winner_id) continue;

    rows.push({
      league_id: leagueId,
      season: seasonFrom,
      tournament_name: t.name,
      winner_id: finalMatchup.winner_id,
    });
  }

  if (rows.length === 0) return 0;

  const { error: insertErr } = await admin
    .from('season_cup_winners_archive')
    .upsert(rows, { onConflict: 'league_id,season,tournament_name' });

  if (insertErr) throw new Error(`Failed to archive cup winners: ${insertErr.message}`);
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
function getPrizeKeyFromNotes(notes: string): string {
  const label = notes.split(' — ')[0];
  if (label.includes('1st Place')) return 'season_1st';
  if (label.includes('Champions Cup Winner')) return 'champions_cup_winner';
  if (label.includes('League Cup Winner')) return 'league_cup_winner';
  if (label.includes('Consolation Cup Winner')) return 'consolation_cup_winner';
  return '';
}

async function sendChampionsNotifications(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
  prizesPaid: { prizeKey: string; teamName: string }[],
): Promise<void> {
  try {
    const { createNotification } = await import('@/lib/notifications/createNotification');
    const { data: leagueTeams } = await admin
      .from('teams')
      .select('user_id')
      .eq('league_id', leagueId);

    const leagueChamp = prizesPaid.find(p => p.prizeKey === 'season_1st')?.teamName;
    const championsCupWinner = prizesPaid.find(p => p.prizeKey === 'champions_cup_winner')?.teamName;
    const leagueCupWinner = prizesPaid.find(p => p.prizeKey === 'league_cup_winner')?.teamName;
    const consolationCupWinner = prizesPaid.find(p => p.prizeKey === 'consolation_cup_winner')?.teamName;

    const shortSeason = seasonFrom.replace(/20(\d{2})-20(\d{2})/g, '$1/$2').replace(/20(\d{2})-(\d{2})/g, '$1/$2');

    if (leagueTeams && leagueTeams.length > 0) {
      for (const t of leagueTeams) {
        // Send League Champions notification
        if (leagueChamp) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'League Champions Crowned!',
            content: `**${leagueChamp}** are your ${shortSeason} League Champions!`,
            url: `/league/${leagueId}/history`
          });
        }

        // Send Champions Cup Winner notification
        if (championsCupWinner) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'Champions Cup Winner!',
            content: `**${championsCupWinner}** have won the Champions Cup!`,
            url: `/league/${leagueId}/tournaments`
          });
        }

        // Send League Cup Winner notification
        if (leagueCupWinner) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'League Cup Winner!',
            content: `**${leagueCupWinner}** have won the League Cup!`,
            url: `/league/${leagueId}/tournaments`
          });
        }

        // Send Consolation Cup Winner notification
        if (consolationCupWinner) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'Consolation Cup Winner!',
            content: `**${consolationCupWinner}** have won the Consolation Cup!`,
            url: `/league/${leagueId}/tournaments`
          });
        }
      }
    }

    // Also send a public system announcement chat message in the lobby
    if (leagueChamp) {
      const shortSeason = seasonFrom.replace(/20(\d{2})-20(\d{2})/g, '$1/$2').replace(/20(\d{2})-(\d{2})/g, '$1/$2');
      await admin.from('chat_messages').insert({
        league_id: leagueId,
        sender_id: null,           // System-generated — no user attribution
        is_system: true,
        recipient_id: null,
        message: `**ALL HAIL THE CHAMPIONS**\n\n- **${leagueChamp}** are Gaffa's official **${shortSeason} League Champions**!\n${championsCupWinner ? `- **${championsCupWinner}** have won the **Champions Cup**!\n` : ''}${leagueCupWinner ? `- **${leagueCupWinner}** have won the **League Cup**!\n` : ''}${consolationCupWinner ? `- **${consolationCupWinner}** have won the **Consolation Cup**!\n` : ''}\nAll dynasty standings and prize allocations are fully updated. Review historical archives at /league/${leagueId}/history!`,
      });
    }
  } catch (err) {
    console.error('[seasonReset] Failed to generate champions notifications:', err);
  }
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
    // Check if matchups or tournaments are missing
    const { count: matchupCount } = await admin
      .from('matchups')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    const { count: tournamentCount } = await admin
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('season', league.current_season);

    if ((matchupCount ?? 0) > 0 && (tournamentCount ?? 0) >= 3) {
      throw new Error(`League is already in offseason mode (season: ${league.current_season}). Reset already ran.`);
    }

    console.warn(`[seasonReset] League is in offseason but has missing schedule (${matchupCount}) or tournaments (${tournamentCount}). Retrying generation steps.`);
    
    // Step 9: Generate new matchup schedule for the upcoming season.
    const scheduleResult = await insertMatchups(admin, leagueId);
    if (!scheduleResult.ok) {
      throw new Error('Failed to generate matchup schedule during retry.');
    }

    // Step 10: Generate all three tournament brackets for the new season.
    const tournamentResult = await createAllTournaments(admin, leagueId, league.current_season);

    // Reconstruct prizes list from transactions table to send notifications
    const { data: txs } = await admin
      .from('transactions')
      .select('notes, team:teams(id, team_name)')
      .eq('league_id', leagueId)
      .eq('type', 'prize_payout')
      .like('notes', `% — ${seasonFrom}`);

    const prizesPaid = ((txs as unknown) as { notes: string; team: { id: string; team_name: string }[] | { id: string; team_name: string } | null }[] ?? []).map((t) => {
      const teamObj = Array.isArray(t.team) ? t.team[0] : t.team;
      return {
        teamId: teamObj?.id ?? '',
        teamName: teamObj?.team_name ?? 'Unknown',
        prizeKey: getPrizeKeyFromNotes(t.notes),
        prizeLabel: t.notes.split(' — ')[0],
        amount: 0,
      };
    });

    await sendChampionsNotifications(admin, leagueId, seasonFrom, prizesPaid);

    return {
      seasonFrom,
      seasonTo,
      prizesPaid,
      totalPrizeFaab: 0,
      matchupsReset: 0,
      tournamentsReset: 0,
      standingsArchived: 0,
      matchupsGenerated: scheduleResult.matchups ?? 0,
      tournamentsCreated: tournamentResult.tournamentsCreated,
    };
  }

  // Step 1: Lock rosters immediately
  await admin
    .from('leagues')
    .update({ roster_locked: true, updated_at: new Date().toISOString() })
    .eq('id', leagueId);

  // Step 2: Archive standings
  const standingsArchived = await archiveStandings(admin, leagueId, seasonFrom);

  // Step 2.2: Archive matchups
  await archiveMatchups(admin, leagueId, seasonFrom);

  // Step 2.4: Archive cup winners
  await archiveCupWinners(admin, leagueId, seasonFrom);

  // Step 2.6: Archive player season stats and ranks
  const { error: playerStatsArchErr } = await admin.rpc('archive_player_season_stats', { p_season: seasonFrom });
  if (playerStatsArchErr) {
    throw new Error(`Failed to archive player season stats: ${playerStatsArchErr.message}`);
  }

  // Step 3: Distribute prizes
  const { paid: prizesPaid, totalFaab: totalPrizeFaab } = await distributeAllPrizes(admin, leagueId, seasonFrom);

  // Step 4: Reset matchup schedule
  const matchupsReset = await resetMatchups(admin, leagueId);

  // Step 6: Reset tournaments
  const tournamentsReset = await resetTournaments(admin, leagueId);

  // Step 7: Reset team season stats (NOT FAAB — that persists)
  await resetTeamSeasonStats(admin, leagueId);

  // Step 7.5: Update active players' season tag to seasonFrom
  const { error: playersSeasonErr } = await admin
    .from('players')
    .update({ pl_season: seasonFrom, updated_at: new Date().toISOString() })
    .eq('is_active', true);

  if (playersSeasonErr) {
    console.error('[seasonReset] Failed to update players season tags:', playersSeasonErr);
  }

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

  // Step 9: Generate new matchup schedule for the upcoming season.
  const scheduleResult = await insertMatchups(admin, leagueId);
  if (!scheduleResult.ok) {
    throw new Error('Failed to generate matchup schedule.');
  }

  // Step 10: Generate all three tournament brackets for the new season.
  const tournamentResult = await createAllTournaments(admin, leagueId, seasonTo);

  // Step 11: Send notifications
  await sendChampionsNotifications(admin, leagueId, seasonFrom, prizesPaid);

  return {
    seasonFrom,
    seasonTo,
    prizesPaid,
    totalPrizeFaab,
    matchupsReset,
    tournamentsReset,
    standingsArchived,
    matchupsGenerated: scheduleResult.matchups ?? 0,
    tournamentsCreated: tournamentResult.tournamentsCreated,
  };
}
