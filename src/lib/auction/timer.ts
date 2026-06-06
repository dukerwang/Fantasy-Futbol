/**
 * Gaffa — Activity-Based Auction Timer
 *
 * Replaces the old fixed-duration + 1-hour anti-snipe model.
 *
 * Formula:
 *   expires_at = min(
 *     first_bid_time + MAX_DURATION,
 *     max(first_bid_time + MIN_DURATION, last_bid_time + INACTIVITY_TIMEOUT)
 *   )
 *
 * This guarantees:
 * - Every auction stays open for at least MIN_DURATION after the first real bid.
 * - After MIN_DURATION, the auction closes INACTIVITY_TIMEOUT hours after the last bid.
 * - No auction runs longer than MAX_DURATION regardless of activity.
 * - A 3am bid cannot close at 4am — it must stay open until at least 3pm.
 */

const MIN_DURATION_MS       = 24 * 60 * 60 * 1000;  // 24 hours
const INACTIVITY_TIMEOUT_MS = 12 * 60 * 60 * 1000;  // 12 hours
export const MAX_DURATION_STD_MS   = 72 * 60 * 60 * 1000;  // 72 hours (standard players)
export const MAX_DURATION_BIG_MS   = 96 * 60 * 60 * 1000;  // 96 hours (≥ €40m market value)
export const BIG_TRANSFER_THRESHOLD = 40.0;                 // market_value in €m

/**
 * Calculate when an auction should expire based on bidding activity.
 *
 * @param firstBidTime  Unix ms timestamp of the first real (non-system-seed) bid.
 * @param lastBidTime   Unix ms timestamp of the most recent bid (use Date.now() for the current bid).
 * @param isBigTransfer True if the player's market_value ≥ BIG_TRANSFER_THRESHOLD.
 * @returns ISO 8601 string for expires_at.
 */
export function calculateExpiresAt(
  firstBidTime: number,
  lastBidTime: number,
  isBigTransfer: boolean,
): string {
  const maxDurationMs = isBigTransfer ? MAX_DURATION_BIG_MS : MAX_DURATION_STD_MS;
  const hardCeiling   = firstBidTime + maxDurationMs;
  const inactivityEnd = lastBidTime  + INACTIVITY_TIMEOUT_MS;
  const minClose      = firstBidTime + MIN_DURATION_MS;
  return new Date(Math.min(hardCeiling, Math.max(minClose, inactivityEnd))).toISOString();
}

/**
 * The initial expires_at for a newly created system-seed auction (no bids yet).
 * This is a fallback: the bid route overwrites it with the activity formula
 * when the first real bid arrives.
 *
 * @param isBigTransfer True if the player's market_value ≥ BIG_TRANSFER_THRESHOLD.
 * @returns ISO 8601 string for expires_at.
 */
export function initialAuctionExpiry(isBigTransfer: boolean): string {
  const maxDurationMs = isBigTransfer ? MAX_DURATION_BIG_MS : MAX_DURATION_STD_MS;
  return new Date(Date.now() + maxDurationMs).toISOString();
}
