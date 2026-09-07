import { describe, expect, it } from 'vitest';
import { selectBestLineup, selectForFormation, type FormationCandidate } from '@/lib/lineups/selectBestLineup';

const player = (id: string, score: number, ...positions: FormationCandidate['positions']): FormationCandidate => ({
  id,
  score,
  positions,
});

function fourTwoFourCandidates(): FormationCandidate[] {
  return [
    player('gk', 10, 'GK'),
    player('lb', 10, 'LB'),
    player('cb-one', 10, 'CB'),
    player('cb-two', 10, 'CB'),
    player('rb', 10, 'RB'),
    player('dm-one', 10, 'DM'),
    player('dm-two', 10, 'DM'),
    player('lw', 10, 'LW'),
    player('rw', 10, 'RW'),
    player('st-one', 10, 'ST'),
    player('st-two', 10, 'ST'),
  ];
}

describe('selectBestLineup', () => {
  it('finds the highest-scoring legal formation and preserves assigned slots', () => {
    const lineup = selectBestLineup(fourTwoFourCandidates());

    expect(lineup?.formation).toBe('4-2-4');
    expect(lineup?.totalScore).toBe(110);
    expect(lineup?.starters.map((starter) => starter.slot)).toEqual([
      'GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'LW', 'ST', 'ST', 'RW',
    ]);
  });

  it('uses secondary positions to fill exact tactical slots', () => {
    const candidates = fourTwoFourCandidates().filter((candidate) => candidate.id !== 'lb');
    candidates.push(player('utility-fullback', 10, 'RB', 'LB'));

    const lineup = selectBestLineup(candidates);

    expect(lineup?.formation).toBe('4-2-4');
    expect(lineup?.starters.find((starter) => starter.slot === 'LB')?.playerId).toBe('utility-fullback');
  });

  it('fills DEF, MID, ATT, then FLEX from the highest scoring unused players', () => {
    const candidates = [
      ...fourTwoFourCandidates(),
      player('bench-def', 4, 'CB'),
      player('bench-mid', 3, 'CM'),
      player('bench-att', 2, 'ST'),
      player('bench-flex', 1, 'GK'),
    ];

    const lineup = selectBestLineup(candidates);

    expect(lineup?.bench).toEqual({
      DEF: 'bench-def',
      MID: 'bench-mid',
      ATT: 'bench-att',
      FLEX: 'bench-flex',
    });
  });

  it('keeps unavailable bench categories empty', () => {
    const lineup = selectBestLineup(fourTwoFourCandidates());

    expect(lineup?.bench).toEqual({ DEF: null, MID: null, ATT: null, FLEX: null });
  });

  it('selects the best XI for a specifically requested formation', () => {
    const candidates = [
      ...fourTwoFourCandidates(),
      player('cm-one', 12, 'CM'),
      player('cm-two', 11, 'CM'),
      player('cm-three', 10, 'CM'),
    ];

    const result = selectForFormation(candidates, '4-3-3');
    expect(result?.formation).toBe('4-3-3');
    expect(result?.starters.map((s) => s.slot)).toEqual([
      'GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW',
    ]);
  });
});
