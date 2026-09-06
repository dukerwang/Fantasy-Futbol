import { describe, it, expect } from 'vitest';
import { deriveXI, type StartRecord } from '../seasonXI';
import { FORMATION_SLOTS, type Formation, type GranularPosition } from '@/types';

const noPoints = () => 0;

/** `n` starts for `playerId` in `slot`, one per gameweek from `from`. */
function starts(playerId: string, slot: GranularPosition, n: number, from = 1): StartRecord[] {
  return Array.from({ length: n }, (_, i) => ({ playerId, slot, gameweek: from + i }));
}

/** A full, unambiguous XI for a formation: one player per slot opening. */
function fullXI(formation: Formation, apps = 10): StartRecord[] {
  const slots = FORMATION_SLOTS[formation] as GranularPosition[];
  const seen = new Map<GranularPosition, number>();
  return slots.flatMap((slot) => {
    const i = seen.get(slot) ?? 0;
    seen.set(slot, i + 1);
    return starts(`${slot}-${i}`, slot, apps);
  });
}

describe('deriveXI', () => {
  it('returns null with nothing to work from', () => {
    expect(deriveXI([], [], noPoints)).toBeNull();
    expect(deriveXI(starts('p', 'GK', 3), [], noPoints)).toBeNull();
  });

  it('picks the most-used formation, not the most recent', () => {
    const fs: Formation[] = ['4-3-3', '4-3-3', '4-3-3', '3-5-2', '3-5-2'];
    const out = deriveXI(fullXI('4-3-3'), fs, noPoints)!;
    expect(out.formation).toBe('4-3-3');
  });

  it('fills every slot of the formation, in FORMATION_SLOTS order', () => {
    const out = deriveXI(fullXI('4-2-1-3'), ['4-2-1-3'], noPoints)!;
    expect(out.starters).toHaveLength(11);
    expect(out.starters.map((p) => p.slot)).toEqual(FORMATION_SLOTS['4-2-1-3']);
  });

  it('gives a repeated slot to different players, never the same one twice', () => {
    // 4-3-3 has two CBs. Three centre-backs competed for them.
    const rows = [
      ...fullXI('4-3-3').filter((s) => s.slot !== 'CB'),
      ...starts('cb-best', 'CB', 20),
      ...starts('cb-second', 'CB', 12),
      ...starts('cb-third', 'CB', 4),
    ];
    const out = deriveXI(rows, ['4-3-3'], noPoints)!;
    const cbs = out.starters.filter((p) => p.slot === 'CB').map((p) => p.playerId);
    expect(cbs).toEqual(['cb-best', 'cb-second']);
    expect(new Set(cbs).size).toBe(2);
    // The one who missed out is in the squad, not lost.
    expect(out.squad.map((p) => p.playerId)).toContain('cb-third');
  });

  it('breaks a tie on starts with points, not alphabetically', () => {
    const rows = [
      ...fullXI('4-3-3').filter((s) => s.slot !== 'ST'),
      ...starts('striker-a', 'ST', 5, 1),
      ...starts('striker-b', 'ST', 5, 20),
    ];
    const points = (playerId: string) => (playerId === 'striker-b' ? 10 : 1);
    const out = deriveXI(rows, ['4-3-3'], points)!;
    expect(out.starters.find((p) => p.slot === 'ST')!.playerId).toBe('striker-b');
  });

  it('sums a starter’s points over the gameweeks he actually started', () => {
    const rows = [...fullXI('4-3-3').filter((s) => s.slot !== 'GK'), ...starts('keeper', 'GK', 3)];
    const out = deriveXI(rows, ['4-3-3'], (id) => (id === 'keeper' ? 7.5 : 0))!;
    const gk = out.starters.find((p) => p.slot === 'GK')!;
    expect(gk.appearances).toBe(3);
    expect(gk.points).toBe(22.5);
  });

  it('counts a utility player once, under his most-used slot, with every start', () => {
    const rows = [
      ...fullXI('4-3-3'),
      ...starts('utility', 'LB', 3, 30),
      ...starts('utility', 'CM', 6, 33),
    ];
    const out = deriveXI(rows, ['4-3-3'], () => 2)!;
    const util = out.squad.filter((p) => p.playerId === 'utility');
    expect(util).toHaveLength(1);
    expect(util[0].slot).toBe('CM');       // where he played most
    expect(util[0].appearances).toBe(9);   // but all nine starts
    expect(util[0].points).toBe(18);
  });

  it('orders the squad by starts, most-used first', () => {
    const rows = [
      ...fullXI('4-3-3'),
      ...starts('sub-a', 'ST', 2, 30),
      ...starts('sub-b', 'ST', 5, 33),
    ];
    const out = deriveXI(rows, ['4-3-3'], noPoints)!;
    expect(out.squad.map((p) => p.playerId)).toEqual(['sub-b', 'sub-a']);
  });

  it('drops a slot nobody ever started in rather than inventing a player', () => {
    // No goalkeeper ever started, so the XI is ten.
    const rows = fullXI('4-3-3').filter((s) => s.slot !== 'GK');
    const out = deriveXI(rows, ['4-3-3'], noPoints)!;
    expect(out.starters).toHaveLength(10);
    expect(out.starters.some((p) => p.slot === 'GK')).toBe(false);
  });

  it('never puts the same player in two shirts', () => {
    const out = deriveXI(fullXI('3-4-2-1'), ['3-4-2-1'], noPoints)!;
    const ids = out.starters.map((p) => p.playerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
