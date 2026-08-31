/**
 * The voice problem is syntactic, so a phrase list cannot catch it.
 *
 * Measured across the 75 outlooks the v0.2 pipeline produced:
 *   63%  contained "fully fit" / "fully healthy" / "fully clear"
 *   49%  opened with a fronted participial or prepositional phrase
 *   36%  used the verb "enters"
 *
 * They share one skeleton — *[Fronted status phrase], [Name] enters [career or
 * season frame] as [role]* — and every individual one reads well. Four in a
 * scroll list do not, which matters far more on a browse page than on a card
 * opened one at a time.
 *
 * These patterns apply to the FIRST SENTENCE only. Nothing here bans a fitness
 * clause outright; it bans opening on one, because opening is what dictates
 * the shape of everything after it.
 */
export const BANNED_OPENING_PATTERNS: RegExp[] = [
  // Status-first openers.
  /^\s*(fully|now fully|completely|entirely)\s+(fit|healthy|clear|recovered)/i,
  /^\s*(fresh off|coming off|now clear of|fully clear of|having recovered)/i,
  // Fronted participial phrases before the subject.
  /^\s*(operating|working|deployed|featuring|serving|arriving|entering|following|having|positioned|established)\b[^.]{0,80},/i,
  // "enters" as the spine of the opening sentence.
  /^[^.!?]{0,140}\benter(s|ing)\b\s+(his|the|a)\b/i,
];

/** Everything before the first sentence-ending punctuation. */
export function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

export function findOpeningIssues(outlook: string): string[] {
  const opening = firstSentence(outlook);
  const issues: string[] = [];
  for (const pattern of BANNED_OPENING_PATTERNS) {
    if (pattern.test(opening)) issues.push(pattern.source);
  }
  return issues;
}

/**
 * Deterministic opening angle, seeded by player id.
 *
 * Telling the model to "vary the opening" produced the uniformity above,
 * because left free it picks the same safe move every time. Assigning an angle
 * per player forces spread across the pool while keeping any one player's
 * outlook stable between regenerations.
 */
export const OPENING_ANGLES = [
  'his role in the side and how he is used',
  'where he plays and what he does on the pitch',
  'his career stage and what it means for him now',
  'who he is competing with for minutes',
  'what his underlying numbers show',
  'his club situation and what has changed there',
] as const;

export function openingAngleFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OPENING_ANGLES[(h >>> 0) % OPENING_ANGLES.length];
}
