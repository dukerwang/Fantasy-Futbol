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
  // Generic team-as-subject openers, the club-name pattern without the name.
  /^\s*(the|his)\s+(club|side|team|manager)\b/i,
];

/**
 * Escape a club name for use inside a RegExp — "Nott'm Forest" and the like
 * carry characters that would otherwise change the pattern's meaning.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Everything before the first sentence-ending punctuation. */
export function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

/**
 * @param club the player's club, so the gate can reject it as the opening
 *   subject. Fixing the fitness opener produced this in its place: across 39
 *   v0.3 outlooks, 36% began with the club — "Arsenal's right wing runs through
 *   Bukayo Saka…", "Arsenal deploy Zubimendi as…" — over the ~20% ceiling any
 *   single opening move should hold. An outlook is about the player; he should
 *   be the subject of its first sentence.
 */
export function findOpeningIssues(outlook: string, club?: string): string[] {
  const opening = firstSentence(outlook);
  const issues: string[] = [];
  for (const pattern of BANNED_OPENING_PATTERNS) {
    if (pattern.test(opening)) issues.push(pattern.source);
  }
  if (club && club.trim()) {
    const clubPattern = new RegExp(`^\\s*${escapeRegExp(club.trim())}(['\u2019]s)?\\b`, 'i');
    if (clubPattern.test(opening)) issues.push(`opens on the club: ${club}`);
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
/**
 * Every angle is phrased to make the PLAYER the grammatical subject. The first
 * version described the situation instead — "his role in the side", "his club
 * situation" — and four of six invited the club to open the sentence, which is
 * exactly what happened.
 */
export const OPENING_ANGLES = [
  'what he actually does on the pitch, in concrete terms',
  'how secure his place is and who he is holding off',
  'the stage his career has reached and what follows from it',
  'a specific, verified recent fact about him',
  'what his underlying numbers say about him',
  'the one thing that has changed for him lately',
] as const;

export function openingAngleFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OPENING_ANGLES[(h >>> 0) % OPENING_ANGLES.length];
}
