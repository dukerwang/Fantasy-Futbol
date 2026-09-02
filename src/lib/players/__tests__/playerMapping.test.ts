import { describe, it, expect } from 'vitest';
import {
  isPlayerMapped,
  isPlayerPositionMapped,
  isPlayerValueMapped,
  hasCuratedPositionOverride,
} from '../playerMapping';

describe('playerMapping', () => {
  it('identifies unmapped players (e.g. fresh arrival with null position and null valuation)', () => {
    const freshPlayer = {
      name: 'Bradley Barcola',
      web_name: 'Barcola',
      primary_position: null,
      market_value: null,
      market_value_updated_at: null,
      sofifa_common_name: null,
    };

    expect(isPlayerPositionMapped(freshPlayer)).toBe(false);
    expect(isPlayerValueMapped(freshPlayer)).toBe(false);
    expect(isPlayerMapped(freshPlayer)).toBe(false);
  });

  it('identifies fully mapped players with valid position, valuation, and SoFIFA info', () => {
    const syncedPlayer = {
      name: 'Trent Alexander-Arnold',
      web_name: 'Alexander-Arnold',
      primary_position: 'RB',
      secondary_positions: ['RWB', 'CM'],
      market_value: 70,
      market_value_updated_at: '2026-08-01T00:00:00Z',
      sofifa_common_name: 'Alexander-Arnold',
    };

    expect(isPlayerPositionMapped(syncedPlayer)).toBe(true);
    expect(isPlayerValueMapped(syncedPlayer)).toBe(true);
    expect(isPlayerMapped(syncedPlayer)).toBe(true);
  });

  it('recognizes curated position overrides', () => {
    const overriddenPlayer = {
      name: 'Martín Zubimendi',
      web_name: 'Zubimendi',
      primary_position: 'DM',
      market_value: 50,
      market_value_updated_at: '2026-08-01T00:00:00Z',
      sofifa_common_name: null,
    };

    expect(hasCuratedPositionOverride(overriddenPlayer)).toBe(true);
    expect(isPlayerPositionMapped(overriddenPlayer)).toBe(true);
    expect(isPlayerValueMapped(overriddenPlayer)).toBe(true);
    expect(isPlayerMapped(overriddenPlayer)).toBe(true);
  });

  it('rejects players who only have a position but no real market valuation', () => {
    const unvaluedPlayer = {
      name: 'Some Rookie',
      web_name: 'Rookie',
      primary_position: 'CB',
      secondary_positions: [],
      market_value: null,
      market_value_updated_at: null,
      sofifa_common_name: 'Rookie',
    };

    expect(isPlayerPositionMapped(unvaluedPlayer)).toBe(true);
    expect(isPlayerValueMapped(unvaluedPlayer)).toBe(false);
    expect(isPlayerMapped(unvaluedPlayer)).toBe(false);
  });

  it('rejects players who only have market valuation but no SoFIFA position mapping', () => {
    const unpositionedPlayer = {
      name: 'Unmapped Player',
      web_name: 'Unmapped',
      primary_position: null,
      market_value: 15,
      market_value_updated_at: '2026-08-01T00:00:00Z',
      sofifa_common_name: null,
    };

    expect(isPlayerPositionMapped(unpositionedPlayer)).toBe(false);
    expect(isPlayerValueMapped(unpositionedPlayer)).toBe(true);
    expect(isPlayerMapped(unpositionedPlayer)).toBe(false);
  });
});
