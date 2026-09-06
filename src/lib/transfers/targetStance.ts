/**
 * What a target is SAYING, from what the club is offering.
 *
 * The demand-side sibling of `listingStance`. The three booleans carry the
 * SAME NAMES as a listing's and the OPPOSITE meanings: on a listing
 * `open_to_sale` means the seller wants cash for him, on a target it means
 * this club will pay cash. That inversion is exactly why the two are separate
 * functions — sharing one would print "For sale" on a target, which reads as
 * the club offering the player they are trying to sign.
 *
 * "Both, or neither" collapses to the same headline, same as listings: a club
 * that ticked everything and one that ticked nothing are in the same position
 * (open to whatever you bring), and a distinction the reader cannot act on is
 * not worth drawing.
 *
 * Unlike a listing there is no mechanism tier here — a target has no auction,
 * no floor and no clause, because it is not transactable. Budget is the only
 * number, and it qualifies the cash stance rather than dominating it.
 */

export type TargetStanceTone = 'cash' | 'players' | 'loan' | 'open';

export interface TargetStance {
  headline: string;
  tone: TargetStanceTone;
}

export interface TargetStanceInput {
  /** I'll pay cash. */
  open_to_sale: boolean;
  /** I'll give players. */
  open_to_trade: boolean;
  /** I'd take him on loan. */
  open_to_loan: boolean;
  /** What this club will spend, in €m. Absent means unstated. */
  budget?: number | null;
}

export function targetStance(t: TargetStanceInput): TargetStance {
  const { open_to_sale: cash, open_to_trade: players, open_to_loan: loan } = t;

  // Zero is not a budget — it is a field nobody filled in, the same reading
  // `listingStance` gives an ask_price of 0.
  const named = t.budget != null && t.budget > 0;
  const stated = [cash, players, loan].filter(Boolean).length;

  if (stated === 1 && cash) {
    return {
      headline: named ? `Will pay cash · up to €${t.budget}m` : 'Will pay cash',
      tone: 'cash',
    };
  }
  if (stated === 1 && players) return { headline: 'Offering players', tone: 'players' };
  if (stated === 1 && loan) return { headline: 'Would take him on loan', tone: 'loan' };

  return { headline: 'Open to approaches', tone: 'open' };
}
