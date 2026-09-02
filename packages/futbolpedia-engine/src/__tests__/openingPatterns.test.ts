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

describe('the club-opener gate', () => {
  /** Real v0.3 openings — the pattern that replaced the one we just removed. */
  const CLUB_OPENERS: Array<[string, string]> = [
    ["Arsenal's right wing runs through Bukayo Saka, who isolates full-backs.", 'Arsenal'],
    ['Arsenal deploy Zubimendi as the deep-lying orchestrator at the base of midfield.', 'Arsenal'],
    ["Arsenal's midfield construction revolves around Bruno Guimarães.", 'Arsenal'],
    ["Arsenal's central defensive hierarchy features fresh cover in Ezri Konsa.", 'Arsenal'],
  ];

  it('rejects an outlook that opens on the club', () => {
    for (const [text, club] of CLUB_OPENERS) {
      expect(findOpeningIssues(text, club), text).not.toHaveLength(0);
    }
  });

  it('accepts the same content with the player as subject', () => {
    const fixed = [
      ['Saka isolates opposing full-backs and cuts inside onto his left foot.', 'Arsenal'],
      ['Zubimendi orchestrates from the base of midfield, press-resistant under pressure.', 'Arsenal'],
    ] as const;
    for (const [text, club] of fixed) {
      expect(findOpeningIssues(text, club), text).toHaveLength(0);
    }
  });

  it('does not fire on a club mentioned later in the opening sentence', () => {
    const text = 'Gabriel anchors the Arsenal defence and wins nearly everything in the air.';
    expect(findOpeningIssues(text, 'Arsenal')).toHaveLength(0);
  });

  it('handles a club name carrying regex characters', () => {
    expect(findOpeningIssues("Nott'm Forest press high from the front.", "Nott'm Forest")).not.toHaveLength(0);
    expect(findOpeningIssues('Wood leads the line for Forest.', "Nott'm Forest")).toHaveLength(0);
  });

  it('rejects the generic team-as-subject dodge', () => {
    expect(findOpeningIssues('His side build from the back through him.', 'Arsenal')).not.toHaveLength(0);
  });
});

/**
 * Measured across the 20-player 0.3.2 sample: 10 of the 12 players drawing the
 * role-security angle opened "[Name] commands…", and 0.3.1 had used "holds an
 * iron / unshakeable grip" to do the same job. Every string below is a real
 * opening one of those runs shipped.
 */
describe('the security-verb gate', () => {
  it('rejects security asserted as a state', () => {
    for (const text of [
      "Cash commands the starting right-back role in Unai Emery's lineup.",
      'Donnarumma commands the undisputed starting goalkeeper role for Manchester City.',
      "Estêvão commands an untouchable standing within Chelsea's hierarchy.",
      "Ryan Gravenberch commands Liverpool's midfield as an undisputed first-choice pivot.",
      "Isak commands the central striker role as Liverpool's focal point.",
      "Kelleher commands absolute security as Brentford's undisputed number one.",
      'Sangaré commands an unquestioned starting berth in central midfield.',
      'Ian Maatsen commands the starting left-back spot at Aston Villa.',
      'Saka commands an unquestioned grip on the right-wing berth.',
      'Truffert commands undisputed ownership of the left-back slot.',
      "Cash holds an iron grip on Aston Villa's right flank.",
      'Saka holds an unshakeable grip on the right flank.',
    ]) {
      expect(findOpeningIssues(text), text).not.toHaveLength(0);
    }
  });

  it('allows the evidence the angle now asks for instead', () => {
    for (const text of [
      'Maatsen has started every league match at left-back since Lucas Digne left.',
      'Truffert displaced Milos Kerkez at left-back and has not been dropped since.',
      "Bergvall started Tottenham's opener before shifting into a rotation role.",
      'Wan-Bissaka shares right-back duties in direct competition with Matty Cash.',
      "Kostoulas rotates across Brighton's front, competing alongside senior options.",
    ]) {
      expect(findOpeningIssues(text), text).toHaveLength(0);
    }
  });

  it('spares the literal goalkeeping sense, which is football rather than filler', () => {
    for (const text of [
      "Donnarumma commands his area with the authority that made him Italy's number one.",
      'Kelleher commands the box on set pieces and sweeps behind a high line.',
    ]) {
      expect(findOpeningIssues(text), text).toHaveLength(0);
    }
  });
});
