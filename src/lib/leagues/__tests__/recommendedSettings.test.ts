import { describe, it, expect } from 'vitest';
import { computeRecommendedSettings } from '../recommendedSettings';

describe('computeRecommendedSettings', () => {
    it('matches production defaults for standard/dynasty at 10 teams', () => {
        const d = computeRecommendedSettings({ maxTeams: 10, profile: 'standard', isDynasty: true });
        expect(d).toEqual({ rosterSize: 20, benchSize: 4, irSize: 2, faabBudget: 250 });
    });

    it.each([
        ['casual', 4, 22], ['casual', 6, 20], ['casual', 8, 18],
        ['standard', 5, 24], ['standard', 7, 22], ['standard', 12, 20],
        ['deep', 4, 28], ['deep', 6, 26], ['deep', 9, 24],
    ] as const)('roster size for %s at %i teams (dynasty) is %i', (profile, maxTeams, expected) => {
        const d = computeRecommendedSettings({ maxTeams, profile, isDynasty: true });
        expect(d.rosterSize).toBe(expected);
    });

    it('subtracts 2 from roster size for redraft, before deriving bench/IR', () => {
        const dynasty = computeRecommendedSettings({ maxTeams: 8, profile: 'casual', isDynasty: true });
        const redraft = computeRecommendedSettings({ maxTeams: 8, profile: 'casual', isDynasty: false });
        expect(dynasty.rosterSize).toBe(18);
        expect(redraft.rosterSize).toBe(16);
        expect(redraft.benchSize).toBe(3);
        expect(redraft.irSize).toBe(1);
    });

    it('crosses the IR breakpoint below roster size 18', () => {
        const at18 = computeRecommendedSettings({ maxTeams: 8, profile: 'casual', isDynasty: true });
        const at16 = computeRecommendedSettings({ maxTeams: 8, profile: 'casual', isDynasty: false });
        expect(at18.rosterSize).toBe(18);
        expect(at18.irSize).toBe(2);
        expect(at16.rosterSize).toBe(16);
        expect(at16.irSize).toBe(1);
    });

    it('crosses the IR breakpoint at roster size 23', () => {
        const at22 = computeRecommendedSettings({ maxTeams: 7, profile: 'standard', isDynasty: true });
        const at24 = computeRecommendedSettings({ maxTeams: 5, profile: 'standard', isDynasty: true });
        expect(at22.rosterSize).toBe(22);
        expect(at22.irSize).toBe(2);
        expect(at24.rosterSize).toBe(24);
        expect(at24.irSize).toBe(3);
    });

    it('rounds and clamps Club Balance at the smallest team count', () => {
        expect(computeRecommendedSettings({ maxTeams: 4, profile: 'casual', isDynasty: true }).faabBudget).toBe(400);
        expect(computeRecommendedSettings({ maxTeams: 4, profile: 'standard', isDynasty: true }).faabBudget).toBe(500);
        expect(computeRecommendedSettings({ maxTeams: 4, profile: 'deep', isDynasty: true }).faabBudget).toBe(500);
    });

    it('rounds and clamps Club Balance at the largest team count', () => {
        expect(computeRecommendedSettings({ maxTeams: 12, profile: 'casual', isDynasty: true }).faabBudget).toBe(150);
        expect(computeRecommendedSettings({ maxTeams: 12, profile: 'standard', isDynasty: true }).faabBudget).toBe(200);
        expect(computeRecommendedSettings({ maxTeams: 12, profile: 'deep', isDynasty: true }).faabBudget).toBe(300);
    });
});
