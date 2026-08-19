/**
 * Mirrors public.snake_draft_order(pick_number, num_teams) in
 * supabase/migrations/011_auto_pick_cron.sql — same 1-indexed pick number,
 * same 0-indexed round math. Kept as a pure function here so the auto-pick
 * route can work out who's on the clock without a second RPC round trip;
 * auto_pick_expired_drafts() itself is the source of truth for the pick.
 */
export function snakeDraftOrder(pickNumber: number, numTeams: number): number {
  const roundNum = Math.floor((pickNumber - 1) / numTeams);
  const posInRound = (pickNumber - 1) % numTeams;
  return roundNum % 2 === 0 ? posInRound + 1 : numTeams - posInRound;
}
