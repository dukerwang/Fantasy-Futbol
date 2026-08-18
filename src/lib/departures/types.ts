/**
 * Gaffa — Departure Decisions (the Retained List)
 *
 * A departure is one player leaving the Premier League, recorded once per
 * league that rosters him. The owning manager chooses what to do about it:
 * take the compensation and let him go, or forfeit the cash and keep his
 * rights against a future return.
 *
 * See supabase/migrations/072_departure_decisions.sql for the rationale and
 * the lifecycle diagram.
 */

export type DepartureDecisionStatus =
  | 'pending'
  | 'released'
  | 'retained'
  | 'return_pending'
  | 'returned'
  | 'relinquished'
  | 'lapsed';

/** Statuses that still occupy one of the team's retained slots. */
export const SLOT_CONSUMING_STATUSES: DepartureDecisionStatus[] = ['retained', 'return_pending'];

/**
 * Statuses that mean the rights are still live — the player is not available
 * to anyone else in the league. The auction ownership filter keys off this;
 * without it the nightly sweep would put a retained player on the block out
 * from under the manager who paid for him with forgone compensation.
 */
export const RIGHTS_HELD_STATUSES: DepartureDecisionStatus[] = ['retained', 'return_pending'];

/** Statuses awaiting a manager action, i.e. anything that can still change. */
export const OPEN_STATUSES: DepartureDecisionStatus[] = ['pending', 'retained', 'return_pending'];

export interface DepartureDecision {
  id: string;
  league_id: string;
  team_id: string;
  original_team_id: string;
  player_id: string;
  season_from: string;
  status: DepartureDecisionStatus;
  market_value_at_departure: number | null;
  compensation_offered: number | null;
  compensation_paid: number | null;
  detected_at: string;
  decide_by: string | null;
  decided_at: string | null;
  returned_at: string | null;
  reinstate_by: string | null;
  resolved_at: string | null;
  notes: string | null;
}

/**
 * How long a manager gets to choose on a departure detected mid-season.
 * Offseason departures use Kickoff as their deadline instead — it is the
 * commissioner action that ends the grace period, and it can be weeks away.
 * Was 72h (3 days) until 2026-08-18 — a real window, but tight enough that a
 * manager away for a weekend could miss it and get auto-released without ever
 * seeing the choice. A week gives a normal travel/busy-week gap real room.
 */
export const MIDSEASON_DECISION_HOURS = 24 * 7;

/**
 * How long a rights holder gets to make roster room once a retained player is
 * back in the Premier League. Matches the standard auction window so the two
 * read consistently to managers.
 */
export const RETURN_WINDOW_HOURS = 48;
