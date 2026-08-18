/**
 * Gaffa — Departure Resolver
 *
 * The recurring half of the Retained List. Three jobs, all idempotent and all
 * safe to run on a schedule:
 *
 *   1. Detect retained players who are back in the Premier League and open
 *      their reinstatement window.
 *   2. Expire return windows nobody acted on — the player goes to auction.
 *   3. Auto-release mid-season departures whose decision deadline has passed,
 *      so an unresponsive manager never leaves a player in limbo.
 *
 * Offseason departures are deliberately NOT auto-released here. Their deadline
 * is Kickoff, which resolves them in bulk (see seasonKickoff).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/createNotification';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { lapseReturn, releaseDeparture } from './decisions';
import { RETURN_WINDOW_HOURS, type DepartureDecision } from './types';

export interface ResolveSummary {
  returnsOpened: { decisionId: string; playerName: string; teamName: string }[];
  returnsExpired: { decisionId: string; playerName: string }[];
  autoReleased: { decisionId: string; playerName: string; compensation: number }[];
  errors: string[];
}

export async function resolveDepartureDecisions(admin: SupabaseClient): Promise<ResolveSummary> {
  const summary: ResolveSummary = {
    returnsOpened: [],
    returnsExpired: [],
    autoReleased: [],
    errors: [],
  };

  await openReturnWindows(admin, summary);
  await expireReturnWindows(admin, summary);
  await autoReleaseOverdue(admin, summary);

  return summary;
}

/**
 * A retained player reappearing in the FPL bootstrap (is_active back to true)
 * is the return signal. That covers every route back — summer transfer, January
 * window, promotion with his club, a loan into the PL — because all of them end
 * with the player in FPL's squad list again.
 */
async function openReturnWindows(admin: SupabaseClient, summary: ResolveSummary): Promise<void> {
  const { data: retained, error } = await admin
    .from('departure_decisions')
    .select('id, league_id, team_id, player_id')
    .eq('status', 'retained');

  if (error) {
    summary.errors.push(`load retained: ${error.message}`);
    return;
  }
  if (!retained || retained.length === 0) return;

  const playerIds = [...new Set(retained.map((r) => r.player_id as string))];
  const { data: backInPl } = await admin
    .from('players')
    .select('id, name, web_name, pl_team')
    .eq('is_active', true)
    .in('id', playerIds);

  if (!backInPl || backInPl.length === 0) return;
  const backById = new Map(backInPl.map((p) => [p.id as string, p]));

  const now = new Date();
  const reinstateBy = new Date(now.getTime() + RETURN_WINDOW_HOURS * 60 * 60 * 1000);

  for (const decision of retained) {
    const player = backById.get(decision.player_id as string);
    if (!player) continue;

    const { error: updErr } = await admin
      .from('departure_decisions')
      .update({
        status: 'return_pending',
        returned_at: now.toISOString(),
        reinstate_by: reinstateBy.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', decision.id)
      .eq('status', 'retained'); // lost race = someone else already moved it

    if (updErr) {
      summary.errors.push(`open return ${decision.id}: ${updErr.message}`);
      continue;
    }

    const { data: team } = await admin
      .from('teams')
      .select('team_name, user_id')
      .eq('id', decision.team_id)
      .single();

    const name = getPlayerDisplayName(player, 'full');
    summary.returnsOpened.push({
      decisionId: decision.id as string,
      playerName: name,
      teamName: team?.team_name ?? 'Unknown',
    });

    if (team?.user_id) {
      try {
        await createNotification(admin, {
          leagueId: decision.league_id as string,
          userId: team.user_id,
          title: 'Player Returned',
          content:
            `**${name}** has returned to the Premier League${player.pl_team ? ` with ${player.pl_team}` : ''}. ` +
            `You hold his rights — reinstate him within **${RETURN_WINDOW_HOURS} hours** or he goes to auction. ` +
            `You will need an open squad place.`,
          url: `/league/${decision.league_id}/team/roster`,
        });
      } catch (err) {
        console.error('[departures] return notification failed:', err);
      }
    }
  }
}

/** Return windows nobody acted on. The player goes to open auction. */
async function expireReturnWindows(admin: SupabaseClient, summary: ResolveSummary): Promise<void> {
  const { data: expired, error } = await admin
    .from('departure_decisions')
    .select('id, player_id')
    .eq('status', 'return_pending')
    .lt('reinstate_by', new Date().toISOString());

  if (error) {
    summary.errors.push(`load expired returns: ${error.message}`);
    return;
  }

  for (const decision of expired ?? []) {
    try {
      await lapseReturn(admin, decision.id as string, 'expired');
      const { data: player } = await admin
        .from('players')
        .select('name, web_name')
        .eq('id', decision.player_id)
        .single();
      summary.returnsExpired.push({
        decisionId: decision.id as string,
        playerName: getPlayerDisplayName(player, 'full'),
      });
    } catch (err) {
      summary.errors.push(`expire return ${decision.id}: ${String(err)}`);
    }
  }
}

/**
 * Mid-season departures whose decision deadline has passed default to release.
 *
 * Release rather than retain is the safe default in both directions: it pays
 * the manager something rather than silently consuming a scarce retained slot
 * they never asked to spend, and it puts the player back into circulation.
 */
async function autoReleaseOverdue(admin: SupabaseClient, summary: ResolveSummary): Promise<void> {
  const { data: overdue, error } = await admin
    .from('departure_decisions')
    .select('id, player_id')
    .eq('status', 'pending')
    .not('decide_by', 'is', null)
    .lt('decide_by', new Date().toISOString());

  if (error) {
    summary.errors.push(`load overdue: ${error.message}`);
    return;
  }

  for (const decision of overdue ?? []) {
    try {
      const result = await releaseDeparture(admin, decision.id as string);
      if (!result) continue;
      const { data: player } = await admin
        .from('players')
        .select('name, web_name')
        .eq('id', decision.player_id)
        .single();
      summary.autoReleased.push({
        decisionId: decision.id as string,
        playerName: getPlayerDisplayName(player, 'full'),
        compensation: result.compensation,
      });
    } catch (err) {
      summary.errors.push(`auto-release ${decision.id}: ${String(err)}`);
    }
  }
}

export type { DepartureDecision };
