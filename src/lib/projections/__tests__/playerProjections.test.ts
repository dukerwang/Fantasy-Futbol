import { describe, it, expect } from 'vitest';
import {
  calculatePlayerProjectedPoints,
  estimateExpectedMinutes,
  type PlayerProjectionInput,
} from '../playerProjections';
import type { TeamMatchEnvironment } from '../teamExpectations';

describe('playerProjections', () => {
  const easyHomeEnv: TeamMatchEnvironment = {
    clubSlug: 'man-city',
    opponentSlug: 'coventry-city',
    isHome: true,
    expectedGoals: 2.85,
    expectedConceded: 0.50,
    cleanSheetProb: 0.58,
  };

  const toughAwayEnv: TeamMatchEnvironment = {
    clubSlug: 'chelsea',
    opponentSlug: 'arsenal',
    isHome: false,
    expectedGoals: 0.95,
    expectedConceded: 1.85,
    cleanSheetProb: 0.16,
  };

  const solidHomeEnv: TeamMatchEnvironment = {
    clubSlug: 'brighton',
    opponentSlug: 'leeds',
    isHome: true,
    expectedGoals: 1.80,
    expectedConceded: 0.90,
    cleanSheetProb: 0.40,
  };

  const toughAwayDefEnv: TeamMatchEnvironment = {
    clubSlug: 'brighton',
    opponentSlug: 'man-city',
    isHome: false,
    expectedGoals: 0.70,
    expectedConceded: 2.30,
    cleanSheetProb: 0.10,
  };

  describe('estimateExpectedMinutes', () => {
    it('returns 0 for injured, suspended, or inactive players', () => {
      expect(estimateExpectedMinutes('i', 'nailed', 100)).toBe(0);
      expect(estimateExpectedMinutes('s', 'nailed', 100)).toBe(0);
      expect(estimateExpectedMinutes('u', 'nailed', 100)).toBe(0);
      expect(estimateExpectedMinutes('n', 'nailed', 100)).toBe(0);
    });

    it('halves minutes for doubtful status', () => {
      const normal = estimateExpectedMinutes('a', 'nailed', 100);
      const doubtful = estimateExpectedMinutes('d', 'nailed', 100);
      expect(doubtful).toBe(normal * 0.5);
    });

    it('orders minutes by role tier', () => {
      const nailed = estimateExpectedMinutes('a', 'nailed', 30);
      const starter = estimateExpectedMinutes('a', 'likely_starter', 30);
      const rotation = estimateExpectedMinutes('a', 'rotation_risk', 30);
      const fringe = estimateExpectedMinutes('a', 'fringe', 30);

      expect(nailed).toBeGreaterThan(starter);
      expect(starter).toBeGreaterThan(rotation);
      expect(rotation).toBeGreaterThan(fringe);
    });
  });

  describe('calculatePlayerProjectedPoints', () => {
    it('returns 0 for unavailable players', () => {
      const player: PlayerProjectionInput = {
        primary_position: 'ST',
        market_value: 100,
        fpl_status: 'i',
      };
      expect(calculatePlayerProjectedPoints(player, easyHomeEnv)).toBe(0.0);
    });

    it('projects elite striker in easy home fixture significantly higher than in tough away fixture', () => {
      const striker: PlayerProjectionInput = {
        primary_position: 'ST',
        market_value: 200,
        minutesRole: 'nailed',
        fpl_status: 'a',
      };

      const homePoints = calculatePlayerProjectedPoints(striker, easyHomeEnv);
      const awayPoints = calculatePlayerProjectedPoints(striker, toughAwayEnv);

      expect(homePoints).toBeGreaterThan(20.0);
      expect(awayPoints).toBeLessThan(12.0);
      expect(homePoints).toBeGreaterThan(awayPoints * 1.8);
    });

    it('suppresses attacking playmaker projections when facing a top defense away', () => {
      const palmer: PlayerProjectionInput = {
        primary_position: 'AM',
        market_value: 100,
        minutesRole: 'nailed',
        fpl_status: 'a',
      };

      const pointsAtArsenal = calculatePlayerProjectedPoints(palmer, toughAwayEnv);
      const pointsVsEasy = calculatePlayerProjectedPoints(palmer, easyHomeEnv);

      expect(pointsAtArsenal).toBeLessThan(11.0);
      expect(pointsVsEasy).toBeGreaterThan(16.0);
    });

    it('correctly projects defenders based on clean sheet odds and goals conceded', () => {
      const defender: PlayerProjectionInput = {
        primary_position: 'CB',
        market_value: 25,
        minutesRole: 'nailed',
        fpl_status: 'a',
      };

      const pointsVsLeeds = calculatePlayerProjectedPoints(defender, solidHomeEnv);
      const pointsAtCity = calculatePlayerProjectedPoints(defender, toughAwayDefEnv);

      // Clean sheet potential keeps home defender solid
      expect(pointsVsLeeds).toBeGreaterThan(7.0);
      // High concession at City collapses defender projection
      expect(pointsAtCity).toBeLessThan(5.0);
    });

    it('heavily discounts bench cameos due to non-linear minutes scaling', () => {
      const starter: PlayerProjectionInput = {
        primary_position: 'ST',
        market_value: 20,
        minutesRole: 'likely_starter',
        fpl_status: 'a',
      };

      const sub: PlayerProjectionInput = {
        primary_position: 'ST',
        market_value: 20,
        minutesRole: 'rotation_risk',
        fpl_status: 'a',
      };

      const starterPts = calculatePlayerProjectedPoints(starter, solidHomeEnv);
      const subPts = calculatePlayerProjectedPoints(sub, solidHomeEnv);

      expect(subPts).toBeLessThan(starterPts * 0.6);
    });
  });
});
