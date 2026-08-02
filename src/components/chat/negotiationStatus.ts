/** Human status label for a trade_proposals/player_loans row shown outside its answer window. */
export function formatNegotiationStatus(status: string): string {
  switch (status) {
    case 'accepted': return 'Accepted';
    case 'accepted_deferred': return 'Accepted · pending gameweek';
    case 'rejected': return 'Declined';
    case 'cancelled': return 'Withdrawn';
    case 'active': return 'Running';
    case 'recalled': return 'Recalled';
    case 'expired': return 'Expired';
    case 'pending_activation': return 'Pending roster space';
    default: return status;
  }
}
