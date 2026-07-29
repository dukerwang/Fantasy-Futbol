/**
 * What a listing is SAYING, from what the seller is after.
 *
 * Before 088 the three booleans were gates and the card printed them as a
 * permissions matrix — "Trade / No cash / Loan" — which read like an access
 * control list and told you nothing about the seller's position. They are now
 * intent, so the card can state a stance instead: this club wants cash for him,
 * or wants bodies back, or will listen to anything.
 *
 * "Both, or neither" collapses to the same headline on purpose. A seller who
 * ticked everything and a seller who ticked nothing are in the same position —
 * open to whatever you bring — and pretending otherwise would give the manager
 * reading the board a distinction they cannot act on.
 */

export type StanceTone = 'sale' | 'players' | 'loan' | 'open';

export interface ListingStance {
  headline: string;
  tone: StanceTone;
}

export interface StanceInput {
  open_to_trade: boolean;
  open_to_sale: boolean;
  open_to_loan: boolean;
  ask_price?: number | null;
}

export function listingStance(l: StanceInput): ListingStance {
  const { open_to_trade: players, open_to_sale: cash, open_to_loan: loan } = l;
  const stated = [players, cash, loan].filter(Boolean).length;

  if (stated === 1 && cash) {
    // An ask price is optional now, so the headline carries it only when the
    // seller actually named one. Zero counts as unnamed: "asking €0m" is not a
    // price, it is a column that was never filled in.
    const named = l.ask_price != null && l.ask_price > 0;
    return {
      headline: named ? `For sale · €${l.ask_price}m` : 'For sale',
      tone: 'sale',
    };
  }
  if (stated === 1 && players) return { headline: 'Wants players', tone: 'players' };
  if (stated === 1 && loan) return { headline: 'Would loan him out', tone: 'loan' };

  return { headline: 'Open to approaches', tone: 'open' };
}
