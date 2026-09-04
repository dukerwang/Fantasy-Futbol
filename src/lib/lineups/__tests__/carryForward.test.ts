import { describe, it, expect } from 'vitest';
import {
  isLineupComplete,
  resolveEffectiveLineupFromMatchups,
  type MatchupLiteForCarry,
} from '../carryForward';
import type { MatchupLineup } from '@/types';

function createMockLineup(valid = true): MatchupLineup {
  return {
    formation: '4-3-3',
    starters: [
      { slot: 'GK', player_id: valid ? 'p1' : '' },
      { slot: 'LB', player_id: 'p2' },
      { slot: 'CB', player_id: 'p3' },
      { slot: 'CB', player_id: 'p4' },
      { slot: 'RB', player_id: 'p5' },
      { slot: 'CM', player_id: 'p6' },
      { slot: 'CM', player_id: 'p7' },
      { slot: 'CM', player_id: 'p8' },
      { slot: 'LW', player_id: 'p9' },
      { slot: 'ST', player_id: 'p10' },
      { slot: 'RW', player_id: 'p11' },
    ],
    bench: [
      { slot: 'DEF', player_id: 'b1' },
      { slot: 'MID', player_id: 'b2' },
      { slot: 'ATT', player_id: 'b3' },
      { slot: 'FLEX', player_id: 'b4' },
    ],
  };
}

describe('carryForward', () => {
  describe('isLineupComplete', () => {
    it('returns true for a full 11 + 4 lineup', () => {
      const lineup = createMockLineup(true);
      expect(isLineupComplete(lineup)).toBe(true);
    });

    it('returns false for null or undefined', () => {
      expect(isLineupComplete(null)).toBe(false);
      expect(isLineupComplete(undefined)).toBe(false);
    });

    it('returns false if starters has missing player_id', () => {
      const lineup = createMockLineup(false);
      expect(isLineupComplete(lineup)).toBe(false);
    });

    it('returns false if fewer than 11 starters', () => {
      const lineup = createMockLineup(true);
      lineup.starters.pop();
      expect(isLineupComplete(lineup)).toBe(false);
    });

    it('returns false if fewer than 4 bench players', () => {
      const lineup = createMockLineup(true);
      lineup.bench.pop();
      expect(isLineupComplete(lineup)).toBe(false);
    });

    it('returns false if any bench slot has missing player_id', () => {
      const lineup = createMockLineup(true);
      lineup.bench[0].player_id = '';
      expect(isLineupComplete(lineup)).toBe(false);
    });
  });

  describe('resolveEffectiveLineupFromMatchups', () => {
    const teamA = 'team-alpha';
    const teamB = 'team-bravo';

    it('returns the current lineup if already complete', () => {
      const gw1Lineup = createMockLineup(true);
      const gw2Lineup = createMockLineup(true);
      gw2Lineup.formation = '3-4-3';

      const matchups: MatchupLiteForCarry[] = [
        { gameweek: 1, team_a_id: teamA, team_b_id: teamB, lineup_a: gw1Lineup, lineup_b: null },
        { gameweek: 2, team_a_id: teamA, team_b_id: teamB, lineup_a: gw2Lineup, lineup_b: null },
      ];

      const resolved = resolveEffectiveLineupFromMatchups({
        teamId: teamA,
        gameweek: 2,
        allMatchups: matchups,
      });

      expect(resolved?.formation).toBe('3-4-3');
    });

    it('falls back to previous gameweek when current gameweek lineup is null', () => {
      const gw1Lineup = createMockLineup(true);
      gw1Lineup.formation = '4-3-3';

      const matchups: MatchupLiteForCarry[] = [
        { gameweek: 1, team_a_id: teamA, team_b_id: teamB, lineup_a: gw1Lineup, lineup_b: null },
        { gameweek: 2, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
      ];

      const resolved = resolveEffectiveLineupFromMatchups({
        teamId: teamA,
        gameweek: 2,
        allMatchups: matchups,
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.formation).toBe('4-3-3');
      expect(resolved?.starters).toHaveLength(11);
    });

    it('falls back to GW1 when GW2 is null and looking at GW3', () => {
      const gw1Lineup = createMockLineup(true);

      const matchups: MatchupLiteForCarry[] = [
        { gameweek: 1, team_a_id: teamA, team_b_id: teamB, lineup_a: gw1Lineup, lineup_b: null },
        { gameweek: 2, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
        { gameweek: 3, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
      ];

      const resolved = resolveEffectiveLineupFromMatchups({
        teamId: teamA,
        gameweek: 3,
        allMatchups: matchups,
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.starters[0].player_id).toBe('p1');
    });

    it('works when team is team_b in some matchups and team_a in others', () => {
      const gw1Lineup = createMockLineup(true);

      const matchups: MatchupLiteForCarry[] = [
        { gameweek: 1, team_a_id: teamB, team_b_id: teamA, lineup_a: null, lineup_b: gw1Lineup },
        { gameweek: 2, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
      ];

      const resolved = resolveEffectiveLineupFromMatchups({
        teamId: teamA,
        gameweek: 2,
        allMatchups: matchups,
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.starters[0].player_id).toBe('p1');
    });

    it('returns null if team has never saved any lineup', () => {
      const matchups: MatchupLiteForCarry[] = [
        { gameweek: 1, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
        { gameweek: 2, team_a_id: teamA, team_b_id: teamB, lineup_a: null, lineup_b: null },
      ];

      const resolved = resolveEffectiveLineupFromMatchups({
        teamId: teamA,
        gameweek: 2,
        allMatchups: matchups,
      });

      expect(resolved).toBeNull();
    });
  });
});
