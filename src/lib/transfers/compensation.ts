/**
 * Gaffa — Transfer Compensation Logic
 *
 * When a real-world player transfers OUT of the Premier League,
 * any fantasy team that owns that player receives compensation:
 *   Compensation = market_value * COMPENSATION_RATE
 *
 * The FAAB budget of the owning team is credited.
 * The player is marked inactive and dropped from the roster.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fallback fraction of market value refunded when a player leaves the Premier
 * League. The live value is per-league: `leagues.departure_compensation_rate`
 * (migration 069) — read it with `getDepartureCompensationRate()`. This
 * constant is only the default for callers that have no league in hand.
 *
 * The rate is a balance dial, not an implementation detail. It decides whether
 * a manager should ever keep a departed player's rights instead of taking the
 * cash: retaining is rational only when P(player returns to the PL) exceeds
 * rate / auction premium. At 1.0 no premium is high enough, and retention is
 * never the right call.
 *
 * A previous version set this to 1.0 to dodge a rounding artefact —
 * `teams.faab_budget` is an INT column and the RPC casts the payout to it, so
 * €6m at 0.8 credits €5m rather than €4.8m. That is a ±€0.5m rounding on a
 * currency denominated in millions; it is not worth distorting the economy to
 * avoid. Payouts round to the nearest whole million and that is intended.
 *
 * Lowered from 0.8 to 0.6 by migration 091. Two reasons: departure
 * compensation was the second-largest source of newly created money in the
 * league (~EUR 152m/season for six clubs), and at 0.8 the payout was
 * generous enough that releasing beat retaining in almost every case,
 * leaving the Retained List as dead weight. At 0.6, holding rights is a
 * real decision.
 *
 * Exported so the preview path can't drift from what actually gets paid.
 */
export const COMPENSATION_RATE = 0.6;

/**
 * Resolves the departure compensation rate for one league, falling back to
 * COMPENSATION_RATE if the league row or column is unreadable. Every payout
 * path should price off this rather than a literal, so the manual transfer-out
 * and the relegation sweep can never quote different figures for the same
 * event again (they previously disagreed: 0.8 inline vs 1.0 here).
 */
export async function getDepartureCompensationRate(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<number> {
  const { data } = await supabase
    .from('leagues')
    .select('departure_compensation_rate')
    .eq('id', leagueId)
    .single();

  const rate = Number(data?.departure_compensation_rate);
  return Number.isFinite(rate) ? rate : COMPENSATION_RATE;
}
