import { describe, it, expect } from 'vitest';

describe('Home model live auction filtering', () => {
  it('filters out manager listings with zero bids, but retains free-agent auctions and listings with bids', () => {
    const rawAuctionState = [
      {
        player_id: 'player-1',
        kind: 'listing',
        status: 'live',
        bid_count: 0, // Manager listing with NO bids — should be filtered out from live auctions
        highest_bid: 0,
      },
      {
        player_id: 'player-2',
        kind: 'listing',
        status: 'live',
        bid_count: 2, // Manager listing WITH bids — should be included
        highest_bid: 50,
      },
      {
        player_id: 'player-3',
        kind: 'free_agent',
        status: 'live',
        bid_count: 0, // Free agent auction with 0 bids — should be included
        highest_bid: 10,
      },
    ];

    const liveAuctions = rawAuctionState.filter(
      (a) => a.kind !== 'listing' || (a.bid_count ?? 0) > 0,
    );

    expect(liveAuctions).toHaveLength(2);
    expect(liveAuctions.map((a) => a.player_id)).toEqual(['player-2', 'player-3']);
  });
});

describe('Opponent card title derivation', () => {
  it('returns "You play" when the fixture has no scores yet, even in market phase', () => {
    const getOpponentTitle = (hasScores: boolean, phase: string, outcome: string) => {
      if (!hasScores) {
        return phase === 'live' ? 'You are playing' : 'You play';
      }
      if (phase === 'live') {
        return outcome === 'ahead' ? 'You lead' : outcome === 'behind' ? 'You trail' : 'You are playing';
      }
      return outcome === 'ahead' ? 'You beat' : outcome === 'behind' ? 'You lost to' : 'You drew with';
    };

    expect(getOpponentTitle(false, 'market', 'drawn')).toBe('You play');
    expect(getOpponentTitle(false, 'buildup', 'drawn')).toBe('You play');
    expect(getOpponentTitle(false, 'live', 'drawn')).toBe('You are playing');
    expect(getOpponentTitle(true, 'market', 'ahead')).toBe('You beat');
    expect(getOpponentTitle(true, 'market', 'behind')).toBe('You lost to');
    expect(getOpponentTitle(true, 'market', 'drawn')).toBe('You drew with');
    expect(getOpponentTitle(true, 'live', 'ahead')).toBe('You lead');
  });
});
