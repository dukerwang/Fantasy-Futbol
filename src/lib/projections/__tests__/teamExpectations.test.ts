import { describe, it, expect } from 'vitest';
import {
  calculateMatchEnvironment,
  buildGameweekTeamEnvironments,
  getClubStrength,
} from '../teamExpectations';

describe('teamExpectations', () => {
  it('returns valid club strength for existing and default clubs', () => {
    const city = getClubStrength('man-city');
    expect(city.attack).toBeGreaterThan(1.0);
    expect(city.defense).toBeLessThan(1.0); // defense rating < 1.0 means fewer goals conceded

    const defaultStr = getClubStrength('non-existent-club');
    expect(defaultStr.attack).toBe(1.0);
    expect(defaultStr.defense).toBe(1.0);
  });

  it('calculates home advantage and fixture difficulty correctly', () => {
    const { home, away } = calculateMatchEnvironment('man-city', 'coventry-city');

    // Man City at home vs promoted Coventry
    expect(home.expectedGoals).toBeGreaterThan(2.5);
    expect(home.expectedConceded).toBeLessThan(1.0);
    expect(home.cleanSheetProb).toBeGreaterThan(0.4);

    // Coventry away at Man City
    expect(away.expectedGoals).toBeLessThan(1.0);
    expect(away.cleanSheetProb).toBeLessThan(0.15);
  });

  it('correctly models defensive suppression when visiting Arsenal', () => {
    const { home: arsenal, away: chelsea } = calculateMatchEnvironment('arsenal', 'chelsea');

    // Arsenal defense was league-best (0.71 conceded/gm), so Chelsea's expected goals are suppressed
    expect(chelsea.expectedGoals).toBeLessThan(1.0);
    expect(arsenal.expectedGoals).toBeGreaterThan(1.5);
    expect(arsenal.cleanSheetProb).toBeGreaterThan(chelsea.cleanSheetProb);
  });

  it('builds environments map for all fixtures in a gameweek', () => {
    const fixtures = [
      { homeClub: 'arsenal', awayClub: 'chelsea' },
      { homeClub: 'man-city', awayClub: 'coventry-city' },
    ];

    const envs = buildGameweekTeamEnvironments(fixtures);
    expect(envs.size).toBe(4);
    expect(envs.has('arsenal')).toBe(true);
    expect(envs.has('chelsea')).toBe(true);
    expect(envs.has('man-city')).toBe(true);
    expect(envs.has('coventry-city')).toBe(true);
  });
});
