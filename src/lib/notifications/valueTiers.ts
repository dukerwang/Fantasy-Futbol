/**
 * Value tiers for signings that deserve more than the routine treatment.
 *
 * Distinct from `AUCTION_THRESHOLD` (src/lib/offseason/seasonKickoff.ts),
 * which only gates whether a player is auction-worthy at all. These
 * thresholds layer hype copy/visuals on top of that for the biggest moves —
 * kept in their own module (rather than importing from seasonKickoff.ts) so
 * templates.ts, which seasonKickoff.ts itself imports, has no cycle back.
 */

export const BLOCKBUSTER_THRESHOLD = 80;
export const GALACTICO_THRESHOLD = 100;

export type ValueTier = 'standard' | 'blockbuster' | 'galactico';

export function getValueTier(marketValue: number): ValueTier {
  if (marketValue >= GALACTICO_THRESHOLD) return 'galactico';
  if (marketValue >= BLOCKBUSTER_THRESHOLD) return 'blockbuster';
  return 'standard';
}

interface TierCopy {
  eyebrow: string;
  description: string;
}

/** Editorial labels only — no emoji, per house style. `standard` gets no special treatment. */
export const TIER_COPY: Record<ValueTier, TierCopy | null> = {
  standard: null,
  blockbuster: {
    eyebrow: 'Blockbuster Signing',
    description: 'One of the biggest fees the market has seen this window.',
  },
  galactico: {
    eyebrow: 'Galactico Arrival',
    description: 'A genuine marquee arrival — the kind of fee that redraws a market.',
  },
};

/**
 * Escalates an email subject line when the batch includes a Blockbuster+
 * arrival, naming the single highest-value candidate. Falls back to
 * `defaultSubject` when nothing in the batch clears the threshold.
 */
export function buildAuctionSubject(
  players: { name: string; value: number }[],
  defaultSubject: string,
): string {
  const top = [...players].sort((a, b) => b.value - a.value)[0];
  if (!top || getValueTier(top.value) === 'standard') return defaultSubject;
  const label = getValueTier(top.value) === 'galactico' ? 'Galactico Alert' : 'Blockbuster Alert';
  return `${label}: ${top.name} (€${top.value}m) Hits the Market`;
}

/**
 * A trailing sentence for in-app notification `content`, naming the single
 * highest-value candidate when the batch includes a Blockbuster+ arrival.
 * This is the in-app half of the tier convention — the Inbox detects the
 * eyebrow text (e.g. "Blockbuster Signing") to apply hype styling, so the
 * wording here must stay in sync with `TIER_COPY`.
 */
export function buildFeaturedNotice(players: { name: string; value: number }[]): string {
  const top = [...players].sort((a, b) => b.value - a.value)[0];
  if (!top) return '';
  const copy = TIER_COPY[getValueTier(top.value)];
  if (!copy) return '';
  return ` **${copy.eyebrow}:** ${top.name} (€${top.value}m) has hit the market.`;
}

/** Tier eyebrow prefix for a single resolved value (e.g. a winning bid), or '' for standard tier. */
export function tierNoticePrefix(value: number): string {
  const copy = TIER_COPY[getValueTier(value)];
  return copy ? `**${copy.eyebrow}.** ` : '';
}
