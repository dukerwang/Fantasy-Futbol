/**
 * Gaffa — Departure Decision Actions
 *
 * The manager-facing verbs. Every one that moves money or mutates a roster
 * delegates to an RPC (migration 073) so the check and the write happen under
 * one lock — the slot limit in particular is only meaningful if it cannot be
 * raced by two concurrent retain requests.
 *
 * Authorization is the caller's job. These functions assume the acting team
 * has already been proven to own the decision.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AUCTION_THRESHOLD } from '@/lib/offseason/seasonKickoff';
import { createNotification } from '@/lib/notifications/createNotification';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import {
  OPEN_STATUSES,
  RIGHTS_HELD_STATUSES,
  SLOT_CONSUMING_STATUSES,
  RETURN_WINDOW_HOURS,
  type DepartureDecision,
} from './types';

const BIG_AUCTION_HOURS = 96;
const STANDARD_AUCTION_HOURS = 48;

export class DepartureError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DepartureError';
  }
}

/** Every decision in a league, optionally scoped to one team or status set. */
export async function listDecisions(
  admin: SupabaseClient,
  leagueId: string,
  opts: { teamId?: string; statuses?: string[] } = {},
): Promise<DepartureDecision[]> {
  let q = admin.from('departure_decisions').select('*').eq('league_id', leagueId);
  if (opts.teamId) q = q.eq('team_id', opts.teamId);
  if (opts.statuses?.length) q = q.in('status', opts.statuses);

  const { data, error } = await q.order('detected_at', { ascending: false });
  if (error) throw new Error(`Failed to load departure decisions: ${error.message}`);
  return (data ?? []) as DepartureDecision[];
}

/** Decisions still awaiting a manager: pending choices and open return windows. */
export async function listOpenDecisions(
  admin: SupabaseClient,
  leagueId: string,
  teamId?: string,
): Promise<DepartureDecision[]> {
  return listDecisions(admin, leagueId, { teamId, statuses: OPEN_STATUSES });
}

export interface SlotUsage {
  used: number;
  total: number;
  remaining: number;
}

/** How many retained slots this team is using, against the league allowance. */
export async function getSlotUsage(
  admin: SupabaseClient,
  leagueId: string,
  teamId: string,
): Promise<SlotUsage> {
  const { data: league } = await admin
    .from('leagues')
    .select('retained_slots')
    .eq('id', leagueId)
    .single();

  const total = Number(league?.retained_slots ?? 0);

  const { count } = await admin
    .from('departure_decisions')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .in('status', SLOT_CONSUMING_STATUSES);

  const used = count ?? 0;
  return { used, total, remaining: Math.max(0, total - used) };
}

/**
 * Player ids whose rights are held by someone in this league. The auction
 * ownership filter must subtract these: a retained player has no roster entry,
 * so ownership checks that look only at `roster_entries` would treat him as a
 * free agent and put him straight back on the block.
 */
export async function getRightsHeldPlayerIds(
  admin: SupabaseClient,
  leagueId: string,
): Promise<Set<string>> {
  const { data, error } = await admin
    .from('departure_decisions')
    .select('player_id')
    .eq('league_id', leagueId)
    .in('status', RIGHTS_HELD_STATUSES);

  if (error) throw new Error(`Failed to load retained rights: ${error.message}`);
  return new Set((data ?? []).map((d) => d.player_id as string));
}

async function loadDecision(admin: SupabaseClient, decisionId: string): Promise<DepartureDecision> {
  const { data, error } = await admin
    .from('departure_decisions')
    .select('*')
    .eq('id', decisionId)
    .single();
  if (error || !data) throw new DepartureError('NOT_FOUND', 'Departure decision not found.');
  return data as DepartureDecision;
}

async function playerName(admin: SupabaseClient, playerId: string): Promise<string> {
  const { data } = await admin.from('players').select('name, web_name').eq('id', playerId).single();
  return getPlayerDisplayName(data, 'full');
}

/** Take the compensation. Pays the snapshotted offer and drops the player. */
export async function releaseDeparture(
  admin: SupabaseClient,
  decisionId: string,
): Promise<{ compensation: number; newFaab: number } | null> {
  const { data, error } = await admin.rpc('resolve_departure_release_rpc', {
    p_decision_id: decisionId,
  });
  if (error) throw new DepartureError('RELEASE_FAILED', error.message);

  const row = (data as { compensation: number; new_faab: number }[] | null)?.[0];
  if (!row) return null; // already resolved

  const decision = await loadDecision(admin, decisionId);
  try {
    const { data: team } = await admin
      .from('teams')
      .select('user_id')
      .eq('id', decision.team_id)
      .single();
    if (team?.user_id) {
      await createNotification(admin, {
        leagueId: decision.league_id,
        userId: team.user_id,
        title: 'Compensated',
        content: `**${await playerName(admin, decision.player_id)}** has been released. Your club balance has been credited **€${row.compensation}m**.`,
        url: `/league/${decision.league_id}/finance`,
      });
    }
  } catch (err) {
    console.error('[departures] release notification failed:', err);
  }

  return { compensation: Number(row.compensation), newFaab: Number(row.new_faab) };
}

/** Forfeit the compensation, keep the rights. Fails if slots are full. */
export async function retainDeparture(
  admin: SupabaseClient,
  decisionId: string,
): Promise<{ slotsUsed: number; slotsTotal: number } | null> {
  const { data, error } = await admin.rpc('retain_departure_rpc', { p_decision_id: decisionId });

  if (error) {
    if (error.message.includes('RETAINED_SLOTS_FULL')) {
      throw new DepartureError(
        'RETAINED_SLOTS_FULL',
        'All of your retained slots are in use. Relinquish rights to another player first.',
      );
    }
    throw new DepartureError('RETAIN_FAILED', error.message);
  }

  const row = (data as { slots_used: number; slots_total: number }[] | null)?.[0];
  if (!row) return null; // already resolved
  return { slotsUsed: Number(row.slots_used), slotsTotal: Number(row.slots_total) };
}

/**
 * Abandon retained rights for nothing, freeing the slot.
 *
 * Deliberately pays zero. Allowing a later cash-out would rebuild the exploit
 * the Retained List exists to close: retain everything, then convert whatever
 * fails to return back into budget. The compensation was forfeited at the
 * moment of retention and is not recoverable.
 *
 * No auction follows — the player is not in the Premier League, so there is
 * nothing for the league to bid on.
 */
export async function relinquishRights(admin: SupabaseClient, decisionId: string): Promise<void> {
  const decision = await loadDecision(admin, decisionId);
  if (decision.status !== 'retained') {
    throw new DepartureError('NOT_RETAINED', 'Those rights are not currently held.');
  }

  const { error } = await admin
    .from('departure_decisions')
    .update({
      status: 'relinquished',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', decisionId)
    .eq('status', 'retained');

  if (error) throw new DepartureError('RELINQUISH_FAILED', error.message);
}

/** Claim a returned player back onto the roster. Requires an open squad place. */
export async function reinstateReturned(
  admin: SupabaseClient,
  decisionId: string,
): Promise<{ rosterCount: number; rosterSize: number } | null> {
  const { data, error } = await admin.rpc('reinstate_departure_rpc', { p_decision_id: decisionId });

  if (error) {
    if (error.message.includes('ROSTER_FULL')) {
      throw new DepartureError(
        'ROSTER_FULL',
        'Your squad is full. Drop a player to make room before reinstating.',
      );
    }
    throw new DepartureError('REINSTATE_FAILED', error.message);
  }

  const row = (data as { roster_count: number; roster_size: number }[] | null)?.[0];
  if (!row) return null;
  return { rosterCount: Number(row.roster_count), rosterSize: Number(row.roster_size) };
}

/**
 * Give up a returned player — by choice, or because the window ran out. The
 * player goes to a normal system auction, which the rights holder may still
 * bid in: they are surrendering the free reinstatement, not their eligibility.
 */
export async function lapseReturn(
  admin: SupabaseClient,
  decisionId: string,
  reason: 'declined' | 'expired',
): Promise<void> {
  const decision = await loadDecision(admin, decisionId);
  if (decision.status !== 'return_pending') {
    throw new DepartureError('NOT_RETURNING', 'That player is not awaiting reinstatement.');
  }

  const { error } = await admin
    .from('departure_decisions')
    .update({
      status: 'lapsed',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: reason === 'declined' ? 'Rights holder declined reinstatement.' : 'Return window expired.',
    })
    .eq('id', decisionId)
    .eq('status', 'return_pending');

  if (error) throw new DepartureError('LAPSE_FAILED', error.message);

  await openSystemAuction(admin, decision.league_id, decision.player_id);
}

/**
 * Move retained rights to another team. Called by trade execution — rights are
 * a tradeable dynasty asset.
 *
 * `original_team_id` is deliberately left alone. It is the identity the
 * buy-back exclusion is enforced against, so laundering rights through a trade
 * must not clear the restriction on the manager who originally took the cash.
 */
export async function transferRights(
  admin: SupabaseClient,
  decisionId: string,
  toTeamId: string,
): Promise<void> {
  const decision = await loadDecision(admin, decisionId);
  if (!RIGHTS_HELD_STATUSES.includes(decision.status)) {
    throw new DepartureError('NOT_TRADEABLE', 'Those rights are no longer live and cannot be traded.');
  }

  const { error } = await admin
    .from('departure_decisions')
    .update({ team_id: toTeamId, updated_at: new Date().toISOString() })
    .eq('id', decisionId)
    .in('status', RIGHTS_HELD_STATUSES);

  if (error) throw new DepartureError('TRANSFER_FAILED', error.message);
}

/**
 * Opens a standard system auction for a player who has become available.
 * Mirrors the durations used by drops and the nightly sweep, and records the
 * reference price so the auction premium stays computable (migration 070).
 */
export async function openSystemAuction(
  admin: SupabaseClient,
  leagueId: string,
  playerId: string,
): Promise<void> {
  const { data: player } = await admin
    .from('players')
    .select('market_value')
    .eq('id', playerId)
    .single();

  const marketValue = Number(player?.market_value ?? 0);
  const hours = marketValue >= AUCTION_THRESHOLD ? BIG_AUCTION_HOURS : STANDARD_AUCTION_HOURS;

  // Don't stack a second anchor on a live auction for the same player.
  const { data: live } = await admin
    .from('waiver_claims')
    .select('id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .eq('is_auction', true)
    .eq('status', 'pending')
    .is('team_id', null)
    .maybeSingle();

  if (live) return;

  const { error } = await admin.from('waiver_claims').insert({
    league_id: leagueId,
    team_id: null,
    player_id: playerId,
    faab_bid: 0,
    priority: 999,
    status: 'pending',
    gameweek: 0,
    is_auction: true,
    expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
    market_value_at_auction: marketValue,
  });

  if (error) console.error('[departures] Failed to open system auction:', error.message);
}

export { RETURN_WINDOW_HOURS };
