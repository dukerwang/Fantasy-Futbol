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

describe('Matchweek fixture status derivation', () => {
  function deriveMatchweekFixture(m: {
    status: 'scheduled' | 'live' | 'completed';
    score_a: number | string | null;
    score_b: number | string | null;
  }) {
    const a = Number(m.score_a) || 0;
    const b = Number(m.score_b) || 0;
    const isLive = m.status === 'live';
    const isCompleted = m.status === 'completed';
    const shown = m.status !== 'scheduled';
    const drawn = isCompleted && Math.abs(a - b) <= 10;
    return {
      homeScore: shown ? a : null,
      awayScore: shown ? b : null,
      tag: isLive ? 'Live' : isCompleted ? (drawn ? 'Draw' : 'FT') : '',
      drawn,
      live: isLive,
    };
  }

  it('tags active fixtures at kickoff (0.00 vs 0.00) as Live, not Draw', () => {
    const result = deriveMatchweekFixture({
      status: 'live',
      score_a: 0,
      score_b: 0,
    });

    expect(result.live).toBe(true);
    expect(result.drawn).toBe(false);
    expect(result.tag).toBe('Live');
    expect(result.homeScore).toBe(0);
    expect(result.awayScore).toBe(0);
  });

  it('tags active fixtures with unequal scores as Live', () => {
    const result = deriveMatchweekFixture({
      status: 'live',
      score_a: 24.96,
      score_b: 51.97,
    });

    expect(result.live).toBe(true);
    expect(result.drawn).toBe(false);
    expect(result.tag).toBe('Live');
  });

  it('tags completed fixtures within the draw threshold (<= 10 pts) as Draw', () => {
    const result = deriveMatchweekFixture({
      status: 'completed',
      score_a: 42.5,
      score_b: 48.0, // Difference = 5.5 <= 10
    });

    expect(result.live).toBe(false);
    expect(result.drawn).toBe(true);
    expect(result.tag).toBe('Draw');
  });

  it('tags completed fixtures outside the draw threshold as FT', () => {
    const result = deriveMatchweekFixture({
      status: 'completed',
      score_a: 24.96,
      score_b: 51.97, // Difference = 27.01 > 10
    });

    expect(result.live).toBe(false);
    expect(result.drawn).toBe(false);
    expect(result.tag).toBe('FT');
  });

  it('leaves scheduled fixtures with empty tag and null scores', () => {
    const result = deriveMatchweekFixture({
      status: 'scheduled',
      score_a: null,
      score_b: null,
    });

    expect(result.live).toBe(false);
    expect(result.drawn).toBe(false);
    expect(result.tag).toBe('');
    expect(result.homeScore).toBeNull();
    expect(result.awayScore).toBeNull();
  });
});

