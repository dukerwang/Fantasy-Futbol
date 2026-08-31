import { describe, expect, it } from 'vitest';
import {
  OPENING_ANGLES,
  findOpeningIssues,
  firstSentence,
  openingAngleFor,
} from '../gates/openingPatterns';

/** Real openings from the v0.2 run — every one of these shipped. */
const SHIPPED_OPENINGS = [
  'Fully fit after an uninterrupted pre-season, the dynamic No 9 leads the line.',
  'Operating as the primary defensive anchor in a vertical pressing structure, Tyler Adams offers ball-winning stability.',
  'Fresh off his move from Strasbourg, the 22-year-old enters the setup fully fit.',
  'Now entering his prime at age 26, Pedro Neto is fully fit and multi-positional.',
  'Following a British-record switch to Chelsea, Morgan Rogers enters his prime as a cornerstone.',
  'Gabriel Martinelli enters his athletic peak at age 25, possessing direct transitional burst.',
  'Fully clear of previous soft-tissue setbacks, Lucas Bergvall is poised for a leap.',
];

describe('the opening gate', () => {
  it('rejects every formulaic opening the previous run shipped', () => {
    for (const opening of SHIPPED_OPENINGS) {
      expect(findOpeningIssues(opening), opening).not.toHaveLength(0);
    }
  });

  it('accepts openings that lead with a concrete subject', () => {
    const good = [
      'Palmer takes Chelsea’s penalties and most of their direct free kicks, and the attack is built to find him between the lines.',
      'Arsenal have used Saliba as the left-sided centre-back in every league match, ahead of two summer signings.',
      'A hamstring problem in March cost Bergvall six weeks, and Spurs have eased him back through the cups.',
      'At 33, Tarkowski is one of two outfield players to have completed every minute of the campaign.',
    ];
    for (const opening of good) {
      expect(findOpeningIssues(opening), opening).toHaveLength(0);
    }
  });

  it('only judges the first sentence — health later in the paragraph is fine', () => {
    const text =
      'Palmer takes Chelsea’s penalties and most of their direct free kicks. He is fully fit after a minor knock, and operating as the side’s creative hub.';
    expect(findOpeningIssues(text)).toHaveLength(0);
  });

  it('splits the first sentence off cleanly', () => {
    expect(firstSentence('One. Two. Three.')).toBe('One.');
    expect(firstSentence('No terminator here')).toBe('No terminator here');
  });
});

describe('opening angles', () => {
  it('is stable for a player across regenerations', () => {
    const id = '0f7a1c3e-1111-4444-8888-abcdefabcdef';
    expect(openingAngleFor(id)).toBe(openingAngleFor(id));
  });

  it('spreads across the available angles rather than favouring one', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const angle = openingAngleFor(`player-${i}-uuid`);
      counts.set(angle, (counts.get(angle) ?? 0) + 1);
    }
    expect(counts.size).toBe(OPENING_ANGLES.length);
    // No angle should dominate the way "fully fit" did at 63%.
    for (const n of counts.values()) expect(n / 600).toBeLessThan(0.3);
  });
});
