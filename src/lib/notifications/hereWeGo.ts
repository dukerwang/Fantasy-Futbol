/**
 * "Here We Go" voice for confirmed deals — short declarative fragments,
 * transaction type always discernible, no emoji.
 *
 * Rules:
 * - "here we go!" always closes the sentence, never opens it.
 * - It always ends with an exclamation mark.
 * - Standard deals get "here we go!"; Blockbuster gets "HERE WE GO!";
 *   Galáctico gets a "BREAKING: ..." lead-in, still closing on "HERE WE GO!"
 *   (never "BREAKING: HERE WE GO!" glued together — that defeats the escalation).
 * - The default signing pattern is "[Player] to [Club]..." — the closest thing
 *   to real transfer-journalism shorthand. Trades have no real-world
 *   equivalent, so they borrow the "Club A send X to Club B for Y" shape of a
 *   trade report instead.
 */
import { getValueTier, type ValueTier } from '@/lib/notifications/valueTiers';

export type DealType = 'signing' | 'trade' | 'loan';

export interface HereWeGoLine {
  /** A short label for the eyebrow/subject line, e.g. "Blockbuster Trade". Empty for standard tier. */
  eyebrow: string;
  /** The confirmation sentence itself. */
  lead: string;
}

/** Deal-type label used to keep transaction type unambiguous in headlines/subjects. */
export const DEAL_TYPE_LABEL = {
  signing: 'Signing',
  trade: 'Trade',
  loan: 'Loan',
} satisfies Record<DealType, string>;

/** Eyebrow text is dealType-aware — a trade is a "Blockbuster Trade", not a "Blockbuster Signing". */
function tierEyebrow(tier: ValueTier, dealType: DealType): string | null {
  if (tier === 'blockbuster') return `Blockbuster ${DEAL_TYPE_LABEL[dealType]}`;
  if (tier === 'galactico') return dealType === 'signing' ? 'Galactico Arrival' : `Galactico ${DEAL_TYPE_LABEL[dealType]}`;
  return null;
}

/**
 * @param detail A bare clause describing the deal, e.g. "Marcus Odeyemi to FC Meridian for €55m" — no trailing punctuation, buildHereWeGo supplies it.
 * @param value The TIER-DECIDING value — should be the higher of the actual transaction amount and the player's real-world market value, so a bargain FAAB pickup of a genuine superstar (or a bidding war that inflates a nobody) both read correctly. Omit for loans, which aren't on the same scale.
 * @param pending Deferred until the gameweek ends, rather than resolved immediately.
 */
export function buildHereWeGo(
  dealType: DealType,
  detail: string,
  value?: number,
  pending = false,
): HereWeGoLine {
  const tier: ValueTier = value !== undefined ? getValueTier(value) : 'standard';
  const eyebrow = tierEyebrow(tier, dealType);
  const pendingClause = pending ? ', finalizing once the gameweek completes' : '';

  if (tier === 'galactico') {
    return { eyebrow: eyebrow!, lead: `BREAKING: ${detail}${pendingClause}... HERE WE GO!` };
  }
  if (tier === 'blockbuster') {
    return { eyebrow: eyebrow!, lead: `${detail}${pendingClause}, HERE WE GO!` };
  }
  return { eyebrow: '', lead: `${detail}${pendingClause}, here we go!` };
}

/** "Sam Rook, Alex Kim and €10m" — joins an asset list the way a trade report would. */
export function formatAssetList(playerNames: string[], faab: number): string {
  const parts = [...playerNames];
  if (faab > 0) parts.push(`€${faab}m`);
  if (parts.length === 0) return 'nothing of note';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
