/**
 * matchTargets — the join that makes Targets worth having.
 *
 * `roster_entries.on_trade_block` (029, deprecated by 077) failed because it
 * was a signal nothing honoured: a toggle that "never touched the real
 * listings system at all" (Inspector.tsx:64). This module is the difference.
 * When supply appears — a listing, a system auction, a drop — it answers
 * "who said they wanted this?" so the clubs that did get told.
 *
 * It runs at WRITE time on a targeted, indexed query. There is no scan and no
 * cron: the three call sites each hand it one player.
 *
 * Called from:
 *   - POST /api/leagues/[leagueId]/listings   (a manager lists somebody)
 *   - seedHighValueAuctions                   (an arrival opens an auction)
 *   - executeDrop                             (a released player hits the pool)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { POSITION_FLEX_MAP, type GranularPosition, type PlayerTarget } from '@/types';

/** The 12 tactical positions, derived from the flex map so the two can't drift. */
const VALID_POSITIONS = new Set(Object.keys(POSITION_FLEX_MAP));

/** The little a match needs to know about the player who became available. */
export interface MatchablePlayer {
  id: string;
  primary_position?: string | null;
  secondary_positions?: string[] | null;
}

export interface TargetMatch {
  target: PlayerTarget;
  team: { id: string; team_name: string; user_id: string };
  /**
   * True when the target named this player, false when it matched on position.
   * The notice differs: "Saliba is available" vs "A left-back has hit the
   * market", and only the named case is a two-sided match candidate.
   */
  named: boolean;
}

export interface MatchOptions {
  /**
   * The club that owns/sells the player. Its own targets never match — a
   * seller must not be told his own listing answers his own search.
   */
  excludeTeamId?: string | null;
  /**
   * The price of entry in €m, when the event has one (a listing's min_bid, an
   * auction's opening price). Targets whose stated budget falls below it are
   * not notified. Omit for an offers-only listing: with no number to compare
   * against, every matching target hears about it.
   */
  floor?: number | null;
}

interface TeamRow {
  id: string;
  team_name: string;
  user_id: string;
}

/**
 * Active, unexpired targets in this league that this player answers.
 *
 * Returns at most ONE match per club. A club holding both a named target on
 * the player and a profile for his position has said one thing, not two, and
 * should get one notice; the named target wins because it is the more
 * specific statement.
 */
export async function matchTargets(
  admin: SupabaseClient,
  leagueId: string,
  player: MatchablePlayer,
  options: MatchOptions = {},
): Promise<TargetMatch[]> {
  const { excludeTeamId = null, floor = null } = options;

  // Secondary positions count. A club looking for an LB should hear about a
  // CB who also plays there — that flexibility is the whole point of the
  // 12-position taxonomy, and ignoring it would make profiles feel broken on
  // exactly the players who matter most.
  const positions = [player.primary_position, ...(player.secondary_positions ?? [])]
    .filter((p): p is string => typeof p === 'string' && VALID_POSITIONS.has(p));

  const orClauses = [`player_id.eq.${player.id}`];
  if (positions.length > 0) orClauses.push(`position.in.(${positions.join(',')})`);

  let query = admin
    .from('player_targets')
    .select('*')
    .eq('league_id', leagueId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .or(orClauses.join(','));

  if (excludeTeamId) query = query.neq('team_id', excludeTeamId);

  // A stated budget below the floor means this club cannot transact at this
  // price. An unstated budget is not a low one — those clubs still hear.
  if (floor != null) query = query.or(`budget.is.null,budget.gte.${floor}`);

  const { data: targets, error } = await query;
  if (error) throw error;
  if (!targets || targets.length === 0) return [];

  const rows = targets as PlayerTarget[];
  const teamIds = [...new Set(rows.map((t) => t.team_id))];

  // Two lookups, both keyed: who these clubs are, and which of them already
  // hold the player. The second is a guard against telling a manager that a
  // player he owns has become available — a target survives its club
  // acquiring the player some other way, and must not then fire at itself.
  const [{ data: teams }, { data: holders }] = await Promise.all([
    admin.from('teams').select('id, team_name, user_id').in('id', teamIds),
    admin.from('roster_entries').select('team_id').eq('player_id', player.id).in('team_id', teamIds),
  ]);

  const teamById = new Map((teams as TeamRow[] | null ?? []).map((t) => [t.id, t]));
  const alreadyHolds = new Set((holders ?? []).map((r) => (r as { team_id: string }).team_id));

  const byTeam = new Map<string, TargetMatch>();
  for (const target of rows) {
    if (alreadyHolds.has(target.team_id)) continue;

    const team = teamById.get(target.team_id);
    if (!team) continue;

    const named = target.player_id === player.id;
    const existing = byTeam.get(target.team_id);

    // One notice per club; the named target is the more specific statement.
    if (!existing || (named && !existing.named)) {
      byTeam.set(target.team_id, { target, team, named });
    }
  }

  return [...byTeam.values()];
}

/**
 * The positions a target would match against, for callers that need to say
 * WHICH position matched ("A left-back has hit the market"). Named targets
 * have none — they matched the man, not a slot.
 */
export function matchedPosition(match: TargetMatch): GranularPosition | null {
  return match.named ? null : match.target.position;
}
