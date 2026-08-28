import { describe, it, expect } from 'vitest';
import {
  canFitLockedStartersIntoFormation,
  getFormationLockStatus,
  assignStartersForFormation,
  validateLineupSmartLock,
  placementMapFromLineup,
  placementMapFromPayload,
  placementKey,
} from '../smartLock';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot, Player } from '@/types';

function createMockPlayer(id: string, primary: GranularPosition, secondary: GranularPosition[] = []): Player {
  return {
    id,
    name: `Player ${id}`,
    web_name: `P.${id}`,
    primary_position: primary,
    secondary_positions: secondary,
    pl_team: 'ARS',
    pl_team_id: 1,
    fpl_id: 100,
    is_active: true,
    total_points: 0,
    bonus_points: 0,
    form_rating: 0,
    ppg: 0,
    clean_sheets: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    yellow_cards: 0,
    red_cards: 0,
  } as unknown as Player;
}

describe('smartLock', () => {
  describe('canFitLockedStartersIntoFormation', () => {
    it('returns true when there are no locked starters', () => {
      expect(canFitLockedStartersIntoFormation([], '4-3-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation([], '3-5-2')).toBe(true);
    });

    it('allows compatible formation changes for a single locked midfielder', () => {
      const locked = [{ playerId: 'rice', slot: 'CM' as GranularPosition }];
      // 4-3-3 has 2 CMs, 3-5-2 has 2 CMs, 5-3-2 has 2 CMs
      expect(canFitLockedStartersIntoFormation(locked, '4-3-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '3-5-2')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-3-1-2')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-3-2-1')).toBe(true);
    });

    it('blocks formations that lack the required slot count for locked defenders', () => {
      // 4 defenders locked in a 4-3-3 (LB, CB, CB, RB)
      const locked = [
        { playerId: 'p1', slot: 'LB' as GranularPosition },
        { playerId: 'p2', slot: 'CB' as GranularPosition },
        { playerId: 'p3', slot: 'CB' as GranularPosition },
        { playerId: 'p4', slot: 'RB' as GranularPosition },
      ];

      // Formations with LB and RB (4-back formations) should fit
      expect(canFitLockedStartersIntoFormation(locked, '4-3-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-2-1-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-2-2-2')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-3-1-2')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-3-2-1')).toBe(true);
      expect(canFitLockedStartersIntoFormation(locked, '4-2-4')).toBe(true);

      // 3-back formations (3-4-3, 3-5-2, 3-4-1-2, 3-4-2-1) have NO LB/RB (only LWB/RWB)
      expect(canFitLockedStartersIntoFormation(locked, '3-4-3')).toBe(false);
      expect(canFitLockedStartersIntoFormation(locked, '3-5-2')).toBe(false);
      expect(canFitLockedStartersIntoFormation(locked, '3-4-1-2')).toBe(false);
      expect(canFitLockedStartersIntoFormation(locked, '3-4-2-1')).toBe(false);

      // 5-3-2 has LB, RB, and 3 CBs — so LB, 2 CBs, RB fit easily!
      expect(canFitLockedStartersIntoFormation(locked, '5-3-2')).toBe(true);
    });

    it('blocks 2-striker formations when 3 STs are locked (if applicable) or when wingers are locked', () => {
      const lockedWingers = [
        { playerId: 'saka', slot: 'RW' as GranularPosition },
        { playerId: 'martinelli', slot: 'LW' as GranularPosition },
      ];
      // 4-3-3 has LW and RW -> true
      expect(canFitLockedStartersIntoFormation(lockedWingers, '4-3-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation(lockedWingers, '3-4-3')).toBe(true);
      expect(canFitLockedStartersIntoFormation(lockedWingers, '5-2-3')).toBe(true);
      // 3-5-2 and 4-2-2-2 have no LW/RW -> false
      expect(canFitLockedStartersIntoFormation(lockedWingers, '3-5-2')).toBe(false);
      expect(canFitLockedStartersIntoFormation(lockedWingers, '4-2-2-2')).toBe(false);
    });
  });

  describe('getFormationLockStatus', () => {
    it('provides clear explanation when a formation is disabled', () => {
      const locked = [
        { playerId: 'p1', slot: 'LB' as GranularPosition },
        { playerId: 'p2', slot: 'RB' as GranularPosition },
      ];
      const playerNames = new Map([
        ['p1', 'A. Robertson'],
        ['p2', 'B. White'],
      ]);

      const status = getFormationLockStatus(locked, playerNames);
      expect(status['4-3-3'].disabled).toBe(false);
      expect(status['3-5-2'].disabled).toBe(true);
      expect(status['3-5-2'].reason).toContain('A. Robertson');
      expect(status['3-5-2'].reason).toContain('B. White');
    });
  });

  describe('assignStartersForFormation', () => {
    it('pins locked starters to their exact position while mapping unlocked players', () => {
      const pGK = createMockPlayer('gk', 'GK');
      const pLB = createMockPlayer('lb', 'LB', ['LWB']);
      const pCB1 = createMockPlayer('cb1', 'CB');
      const pCB2 = createMockPlayer('cb2', 'CB');
      const pRB = createMockPlayer('rb', 'RB', ['RWB']);
      const pCM1 = createMockPlayer('cm1', 'CM');
      const pDM = createMockPlayer('dm', 'DM');
      const pCM2 = createMockPlayer('cm2', 'CM');
      const pLW = createMockPlayer('lw', 'LW', ['AM']);
      const pST = createMockPlayer('st', 'ST');
      const pRW = createMockPlayer('rw', 'RW', ['AM']);

      const playerMap = new Map([
        ['gk', { player: pGK }],
        ['lb', { player: pLB }],
        ['cb1', { player: pCB1 }],
        ['cb2', { player: pCB2 }],
        ['rb', { player: pRB }],
        ['cm1', { player: pCM1 }],
        ['dm', { player: pDM }],
        ['cm2', { player: pCM2 }],
        ['lw', { player: pLW }],
        ['st', { player: pST }],
        ['rw', { player: pRW }],
      ]);

      // Current 4-3-3: ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW']
      const currentAssignments: Record<number, string | null> = {
        0: 'gk', 1: 'lb', 2: 'cb1', 3: 'cb2', 4: 'rb',
        5: 'cm1', 6: 'dm', 7: 'cm2', 8: 'lw', 9: 'st', 10: 'rw',
      };
      const currentSlots: GranularPosition[] = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW'];

      // Only DM is locked (Friday kickoff)
      const lockedIds = new Set(['dm']);

      // Switch to 4-3-1-2: ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'CM', 'CM', 'AM', 'ST', 'ST']
      // pLW has secondary AM; pRW has secondary AM; pST has primary ST
      // dm has DM; cm1, cm2 have CM
      const pRW2 = createMockPlayer('rw', 'RW', ['ST']);
      playerMap.set('rw', { player: pRW2 });

      const newAssignments = assignStartersForFormation(
        currentAssignments,
        currentSlots,
        '4-3-1-2',
        lockedIds,
        playerMap,
      );

      // DM must still be in the DM slot (index 5 in 4-3-1-2)
      expect(newAssignments[5]).toBe('dm');
      // All 11 slots should be filled with unique players
      const assigned = Object.values(newAssignments);
      expect(assigned.filter(Boolean).length).toBe(11);
      expect(new Set(assigned).size).toBe(11);
    });
  });

  describe('validateLineupSmartLock', () => {
    const prevLineup: MatchupLineup = {
      formation: '4-3-3',
      starters: [
        { player_id: 'gk', slot: 'GK' },
        { player_id: 'lb', slot: 'LB' },
        { player_id: 'cb1', slot: 'CB' },
        { player_id: 'cb2', slot: 'CB' },
        { player_id: 'rb', slot: 'RB' },
        { player_id: 'cm1', slot: 'CM' },
        { player_id: 'dm', slot: 'DM' },
        { player_id: 'cm2', slot: 'CM' },
        { player_id: 'lw', slot: 'LW' },
        { player_id: 'st', slot: 'ST' },
        { player_id: 'rw', slot: 'RW' },
      ],
      bench: [
        { player_id: 'b_def', slot: 'DEF' },
        { player_id: 'b_mid', slot: 'MID' },
        { player_id: 'b_att', slot: 'ATT' },
        { player_id: 'b_flex', slot: 'FLEX' },
      ],
    };

    const playerMap = new Map([
      ['gk', createMockPlayer('gk', 'GK')],
      ['lb', createMockPlayer('lb', 'LB')],
      ['cb1', createMockPlayer('cb1', 'CB')],
      ['cb2', createMockPlayer('cb2', 'CB')],
      ['rb', createMockPlayer('rb', 'RB')],
      ['cm1', createMockPlayer('cm1', 'CM')],
      ['dm', createMockPlayer('dm', 'DM')],
      ['cm2', createMockPlayer('cm2', 'CM')],
      ['lw', createMockPlayer('lw', 'LW')],
      ['st', createMockPlayer('st', 'ST')],
      ['rw', createMockPlayer('rw', 'RW')],
      ['b_def', createMockPlayer('b_def', 'CB')],
      ['b_mid', createMockPlayer('b_mid', 'CM')],
      ['b_att', createMockPlayer('b_att', 'ST')],
      ['b_flex', createMockPlayer('b_flex', 'CM')],
      ['res1', createMockPlayer('res1', 'ST')],
    ]);

    it('passes when unlocked players are swapped and formation changed without affecting locked player', () => {
      const lockedIds = new Set(['dm']); // only DM locked

      // Change formation to 4-2-1-3 and swap unlocked rw for res1 in ST/RW
      const newStarters: { player_id: string; slot: GranularPosition }[] = [
        { player_id: 'gk', slot: 'GK' },
        { player_id: 'lb', slot: 'LB' },
        { player_id: 'cb1', slot: 'CB' },
        { player_id: 'cb2', slot: 'CB' },
        { player_id: 'rb', slot: 'RB' },
        { player_id: 'dm', slot: 'DM' }, // dm preserved at DM
        { player_id: 'cm1', slot: 'DM' },
        { player_id: 'lw', slot: 'LW' },
        { player_id: 'cm2', slot: 'AM' },
        { player_id: 'st', slot: 'ST' },
        { player_id: 'res1', slot: 'RW' },
      ];

      const res = validateLineupSmartLock(prevLineup, newStarters, prevLineup.bench, lockedIds, playerMap);
      expect(res.valid).toBe(true);
    });

    it('fails when a locked starter is moved to a different slot or benched', () => {
      const lockedIds = new Set(['dm']);

      // Attempt to move dm to CM
      const newStarters: { player_id: string; slot: GranularPosition }[] = [
        { player_id: 'gk', slot: 'GK' },
        { player_id: 'lb', slot: 'LB' },
        { player_id: 'cb1', slot: 'CB' },
        { player_id: 'cb2', slot: 'CB' },
        { player_id: 'rb', slot: 'RB' },
        { player_id: 'cm1', slot: 'CM' },
        { player_id: 'dm', slot: 'CM' }, // moved from DM to CM!
        { player_id: 'cm2', slot: 'CM' },
        { player_id: 'lw', slot: 'LW' },
        { player_id: 'st', slot: 'ST' },
        { player_id: 'rw', slot: 'RW' },
      ];

      const res = validateLineupSmartLock(prevLineup, newStarters, prevLineup.bench, lockedIds, playerMap);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('dm');
    });

    it('fails when a locked bench player is promoted to starting XI or dropped', () => {
      const lockedIds = new Set(['b_mid']);

      // Attempt to put b_mid in the starting XI
      const newStarters = [
        ...prevLineup.starters.filter((s) => s.player_id !== 'cm1'),
        { player_id: 'b_mid', slot: 'CM' as GranularPosition },
      ];
      const newBench: { player_id: string; slot: BenchSlot }[] = [
        { player_id: 'b_def', slot: 'DEF' },
        { player_id: 'cm1', slot: 'MID' },
        { player_id: 'b_att', slot: 'ATT' },
        { player_id: 'b_flex', slot: 'FLEX' },
      ];

      const res = validateLineupSmartLock(prevLineup, newStarters, newBench, lockedIds, playerMap);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('b_mid');
    });

    it('fails when a locked reserve player is added to the lineup or bench', () => {
      const lockedIds = new Set(['res1']); // res1 played on Saturday, was not in prevLineup

      const newStarters = [
        ...prevLineup.starters.filter((s) => s.player_id !== 'st'),
        { player_id: 'res1', slot: 'ST' as GranularPosition },
      ];

      const res = validateLineupSmartLock(prevLineup, newStarters, prevLineup.bench, lockedIds, playerMap);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('res1');
    });
  });
});
