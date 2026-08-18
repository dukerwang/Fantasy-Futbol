/**
 * Gaffa — Departure Detection
 *
 * Turns "this rostered player is no longer in the Premier League" into a
 * pending decision the manager has to answer.
 *
 * Detection is not done here: `syncPlayersFromFpl` already marks players
 * `is_active = false` when FPL drops them from the bootstrap or flags their
 * status 'u'. This module only notices which of those are on a roster and
 * opens a decision for them.
 *
 * Safe to run repeatedly. The partial unique index on
 * (league_id, player_id) WHERE status IN ('pending','retained','return_pending')
 * is the real guard — this module filters first so a rerun is a no-op rather
 * than a burst of constraint violations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getDepartureCompensationRate } from '@/lib/transfers/compensation';
import { createNotification } from '@/lib/notifications/createNotification';
import { fetchFplElements, findStillInPl } from '@/lib/players/plPresence';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { MIDSEASON_DECISION_HOURS, OPEN_STATUSES, type DepartureDecision } from './types';

export interface RecordedDeparture {
  decisionId: string;
  playerId: string;
  playerName: string;
  club: string | null;
  teamId: string;
  teamName: string;
  compensationOffered: number;
  marketValue: number;
}

interface RecordOptions {
  /**
   * Season the departure belongs to. Callers in the offseason should pass the
   * season being left behind, not the one starting.
   */
  seasonFrom: string;
  /**
   * Deadline for the manager to choose. Omit during the offseason, where
   * Kickoff resolves anything still pending; pass a date mid-season, where
   * there is no admin action to wait for.
   */
  decideBy?: Date | null;
  /** Best-effort in-app notification to the affected manager. Default true. */
  notify?: boolean;
}

/**
 * Opens a pending departure decision for every player in this league who has
 * left the PL and is still sitting on a roster.
 *
 * The compensation offer is snapshotted here, at detection, and never
 * recomputed. `players.market_value` is overwritten by every Transfermarkt
 * sync, so a figure quoted to a manager on Tuesday is otherwise unreproducible
 * by Friday — and the payout would silently differ from the offer.
 */
export async function recordDepartures(
  admin: SupabaseClient,
  leagueId: string,
  opts: RecordOptions,
): Promise<RecordedDeparture[]> {
  const { data: teams, error: teamsErr } = await admin
    .from('teams')
    .select('id, team_name, user_id')
    .eq('league_id', leagueId);
  if (teamsErr) throw new Error(`Failed to load league teams: ${teamsErr.message}`);
  if (!teams || teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id);

  const { data: entries, error: entriesErr } = await admin
    .from('roster_entries')
    .select('team_id, player_id, status')
    .in('team_id', teamIds)
    .not('player_id', 'is', null);
  if (entriesErr) throw new Error(`Failed to load rostered players: ${entriesErr.message}`);
  if (!entries || entries.length === 0) return [];

  const rosteredIds = [...new Set(entries.map((e) => e.player_id as string))];

  const { data: departed, error: playersErr } = await admin
    .from('players')
    .select('id, name, web_name, pl_team, market_value')
    .eq('is_active', false)
    .in('id', rosteredIds);
  if (playersErr) throw new Error(`Failed to load departed players: ${playersErr.message}`);
  if (!departed || departed.length === 0) return [];

  // `is_active = false` is not proof a player left. The sync deactivates any
  // stored row it fails to fuzzy-match against the FPL bootstrap, so a renamed
  // row, a spelling change or a duplicate row for the same human all look
  // identical to a departure. Opening a decision on one of those ends in real
  // compensation being paid for a player who is still playing — the Murillo /
  // Joelinton / Konaté / Gordon failure, which Kickoff has long been gated
  // against and which this path would otherwise walk straight into on a
  // one-week timer (MIDSEASON_DECISION_HOURS) with no operator in the loop.
  //
  // If FPL is unreachable we record nothing. An unverifiable departure is not a
  // departure, and waiting for the next sync costs nothing.
  const elements = await fetchFplElements();
  if (!elements) {
    console.warn('[departures] FPL unreachable — skipping departure detection this run.');
    return [];
  }

  const stillInPl = findStillInPl(
    departed.map((p) => ({ id: p.id as string, name: (p.name ?? p.web_name ?? '') as string })),
    elements,
  );

  if (stillInPl.size > 0) {
    const names = departed.filter((p) => stillInPl.has(p.id)).map((p) => p.name);
    console.warn(
      `[departures] ${stillInPl.size} player(s) marked departed are still in the FPL bootstrap — ` +
        `treating as corrupted rows, not departures: ${names.join(', ')}`,
    );
  }

  // Skip anyone who already has a live decision in this league — including
  // retained rights, which must not be reopened as a fresh departure.
  const { data: existing, error: existingErr } = await admin
    .from('departure_decisions')
    .select('player_id')
    .eq('league_id', leagueId)
    .in('status', OPEN_STATUSES)
    .in('player_id', departed.map((p) => p.id));
  if (existingErr) throw new Error(`Failed to load open decisions: ${existingErr.message}`);
  const alreadyOpen = new Set((existing ?? []).map((d) => d.player_id as string));

  const rate = await getDepartureCompensationRate(admin, leagueId);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  // A loaned player has TWO roster entries — `loan_out` on the lender and
  // `loan_in` on the borrower — because roster_entries is unique on
  // (player_id, team_id), not on player alone. The compensation belongs to the
  // owner, so the borrower's entry must never win this lookup; taking whichever
  // row came back first would hand the payout to the wrong club roughly half
  // the time.
  const ownerByPlayer = new Map<string, string>();
  for (const e of entries) {
    const playerId = e.player_id as string;
    if (e.status === 'loan_in') continue;
    if (!ownerByPlayer.has(playerId)) ownerByPlayer.set(playerId, e.team_id as string);
  }
  // Fall back to a loan_in entry only if the owning side is somehow absent, so
  // a departure is never dropped silently.
  for (const e of entries) {
    const playerId = e.player_id as string;
    if (!ownerByPlayer.has(playerId)) ownerByPlayer.set(playerId, e.team_id as string);
  }

  interface DepartureDecisionRow {
    league_id: string;
    team_id: string;
    original_team_id: string;
    player_id: string;
    season_from: string;
    status: string;
    market_value_at_departure: number;
    compensation_offered: number;
    decide_by: string | null;
  }

  const rows: DepartureDecisionRow[] = [];
  const recorded: RecordedDeparture[] = [];

  for (const player of departed) {
    if (alreadyOpen.has(player.id)) continue;
    if (stillInPl.has(player.id)) continue;

    const teamId = ownerByPlayer.get(player.id);
    if (!teamId) continue;
    const team = teamById.get(teamId);
    if (!team) continue;

    const marketValue = Number(player.market_value ?? 0);
    const offer = Math.round(marketValue * rate * 100) / 100;

    rows.push({
      league_id: leagueId,
      team_id: teamId,
      original_team_id: teamId,
      player_id: player.id,
      season_from: opts.seasonFrom,
      status: 'pending',
      market_value_at_departure: marketValue,
      compensation_offered: offer,
      decide_by: opts.decideBy ? opts.decideBy.toISOString() : null,
    });

    recorded.push({
      decisionId: '',
      playerId: player.id,
      playerName: getPlayerDisplayName(player, 'full'),
      club: player.pl_team ?? null,
      teamId,
      teamName: team.team_name ?? 'Unknown',
      compensationOffered: offer,
      marketValue,
    });
  }

  if (rows.length === 0) return [];

  // End any live loan on a departing player before opening the decision.
  //
  // The decision only ever touches the owner's roster entry, but a loaned
  // player has two — `loan_out` on the lender and `loan_in` on the borrower.
  // Left alone the borrower keeps a squad place filled by someone who is not in
  // the competition and can never score again, for the rest of the season.
  // This also flips the owner's entry back from `loan_out` to `bench`, so the
  // release/retain RPCs act on an ordinary owned row.
  for (const row of rows) {
    const playerId = row.player_id as string;
    try {
      const { data: loanResult, error: loanErr } = await admin.rpc('terminate_loan_on_departure_rpc', {
        p_league_id: leagueId,
        p_player_id: playerId,
      });
      if (loanErr) {
        console.error(`[departures] Failed to end loan for player ${playerId}:`, loanErr.message);
        continue;
      }

      // The borrower loses a squad member through no action of their own —
      // tell them, rather than letting a player quietly vanish off their team.
      const terminated = (loanResult as { terminated?: { borrower_team_id: string }[] } | null)?.terminated ?? [];
      for (const t of terminated) {
        const record = recorded.find((r) => r.playerId === playerId);
        await notifyLoanTermination(admin, leagueId, t.borrower_team_id, record?.playerName ?? 'A loaned player');
      }
    } catch (err) {
      console.error(`[departures] Loan termination threw for player ${playerId}:`, err);
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from('departure_decisions')
    .insert(rows)
    .select('id, player_id');

  if (insertErr) throw new Error(`Failed to record departures: ${insertErr.message}`);

  const idByPlayer = new Map((inserted ?? []).map((r) => [r.player_id as string, r.id as string]));
  for (const r of recorded) r.decisionId = idByPlayer.get(r.playerId) ?? '';

  if (opts.notify !== false) {
    await notifyDepartures(admin, leagueId, recorded, teams, opts.decideBy ?? null);
  }

  return recorded;
}

async function notifyDepartures(
  admin: SupabaseClient,
  leagueId: string,
  recorded: RecordedDeparture[],
  teams: { id: string; user_id: string }[],
  decideBy: Date | null,
): Promise<void> {
  const userByTeam = new Map(teams.map((t) => [t.id, t.user_id]));
  const deadlineNote = decideBy
    ? ` You have until ${decideBy.toUTCString()} to decide.`
    : ' You can decide any time before the season kicks off.';

  for (const d of recorded) {
    const userId = userByTeam.get(d.teamId);
    if (!userId) continue;
    try {
      await createNotification(admin, {
        leagueId,
        userId,
        title: 'Departure — decision required',
        content:
          `**${d.playerName}**${d.club ? ` (${d.club})` : ''} has left the Premier League. ` +
          `Release him for **€${d.compensationOffered}m**, or retain his rights and keep him if he ever returns.` +
          deadlineNote,
        url: `/league/${leagueId}/team/roster`,
      });
    } catch (err) {
      console.error('[departures] Failed to notify departure:', err);
    }
  }
}

async function notifyLoanTermination(
  admin: SupabaseClient,
  leagueId: string,
  borrowerTeamId: string,
  playerName: string,
): Promise<void> {
  try {
    const { data: team } = await admin
      .from('teams')
      .select('user_id')
      .eq('id', borrowerTeamId)
      .single();
    if (!team?.user_id) return;

    await createNotification(admin, {
      leagueId,
      userId: team.user_id,
      title: 'Loan ended — player left the Premier League',
      content:
        `**${playerName}** has left the Premier League, so your loan has ended early and your squad place is free again. ` +
        `Any performance bonus owed has been settled; the loan fee is not refunded.`,
      url: `/league/${leagueId}/transfers/deals`,
    });
  } catch (err) {
    console.error('[departures] loan termination notification failed:', err);
  }
}

/** Convenience: the deadline for a departure detected mid-season, from now. */
export function midseasonDecideBy(from: Date = new Date()): Date {
  return new Date(from.getTime() + MIDSEASON_DECISION_HOURS * 60 * 60 * 1000);
}

export type { DepartureDecision };
