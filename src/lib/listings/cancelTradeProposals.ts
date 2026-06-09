import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Automatically cancels all pending trade proposals in a league that contain
 * a player who has been locked (e.g. because bidding has started on their sale listing).
 */
export async function cancelTradeProposalsForLockedPlayer(
  admin: SupabaseClient,
  leagueId: string,
  playerId: string
): Promise<void> {
  // Find all pending trade proposals in this league
  const { data: proposals, error } = await admin
    .from('trade_proposals')
    .select('id, offered_players, requested_players')
    .eq('league_id', leagueId)
    .eq('status', 'pending');

  if (error || !proposals || proposals.length === 0) return;

  const toCancel = proposals
    .filter((p) => {
      const offered = Array.isArray(p.offered_players) ? p.offered_players : [];
      const requested = Array.isArray(p.requested_players) ? p.requested_players : [];
      return offered.includes(playerId) || requested.includes(playerId);
    })
    .map((p) => p.id);

  if (toCancel.length > 0) {
    await admin
      .from('trade_proposals')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .in('id', toCancel);
  }
}
