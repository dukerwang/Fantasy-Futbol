import { tierInitialFloorMs, TIER_1_MAX_MV, TIER_2_MAX_MV, TIER_3_MAX_MV } from './timer';

/**
 * One plain sentence for why an auction's clock is doing what it's doing.
 *
 * The mechanics (tier floors, the inactivity reset, the overnight guard) are
 * real and load-bearing, but nothing on a listing card or in the bid dialog
 * ever said so — the countdown just changed and a manager had to already know
 * the rule, or ask. This is the one thing to say for each state, not a
 * restatement of the whole timer.
 */

export type AuctionTimingState = 'not_open' | 'resting' | 'live' | 'settling';

function tierValuePhrase(marketValue: number): string {
  if (marketValue < TIER_1_MAX_MV) return `valued under €${TIER_1_MAX_MV}m`;
  if (marketValue < TIER_2_MAX_MV) return `valued at €${TIER_1_MAX_MV}m–€${TIER_2_MAX_MV}m`;
  if (marketValue < TIER_3_MAX_MV) return `valued at €${TIER_2_MAX_MV}m–€${TIER_3_MAX_MV}m`;
  return `valued at €${TIER_3_MAX_MV}m or more`;
}

export function explainAuctionTiming(marketValue: number, state: AuctionTimingState): string {
  switch (state) {
    case 'not_open':
      return 'Bidding opens for the whole league at the same time, so nobody gets a head start by being awake early.';
    case 'resting': {
      const hours = tierInitialFloorMs(marketValue) / (60 * 60 * 1000);
      return `He's ${tierValuePhrase(marketValue)}, so this auction has a ${hours}-hour minimum before it can close.`;
    }
    case 'live':
      return "Every new bid resets the clock, so the auction can't end while people are still bidding. A deadline that would fall overnight moves to the next morning instead.";
    case 'settling':
      return "This is settling: the clock hit zero, but the result hasn't posted yet.";
  }
}
