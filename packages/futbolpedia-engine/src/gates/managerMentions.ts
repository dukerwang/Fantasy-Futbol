export interface ManagerVerificationContext {
  verifiedFacts: string[];
  supplementalCorpus?: string[];
  currentHeadCoach: string | null;
}

const UNDER_MANAGER_PATTERN =
  /\bunder\s+([A-Z][a-zA-ZÀ-ÿ'’-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’-]+)*)/g;

const POSSESSIVE_MANAGER_PATTERN =
  /\b([A-Z][a-zA-ZÀ-ÿ'’-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'’-]+)?)'s\s+(?:(?:attacking|defensive)\s+)?(?:rotation|system|setup|approach|tactics|side|structure|philosophy)\b/gi;

function collectManagerMentions(text: string): string[] {
  const mentions: string[] = [];
  for (const match of text.matchAll(UNDER_MANAGER_PATTERN)) {
    if (match[1]) mentions.push(match[1].trim());
  }
  for (const match of text.matchAll(POSSESSIVE_MANAGER_PATTERN)) {
    if (match[1]) mentions.push(match[1].trim());
  }
  return mentions;
}

function verificationCorpus(ctx: ManagerVerificationContext): string {
  return [...ctx.verifiedFacts, ...(ctx.supplementalCorpus ?? []), ctx.currentHeadCoach ?? '']
    .join(' ')
    .toLowerCase();
}

function isNameVerified(name: string, corpus: string): boolean {
  const normalized = name.toLowerCase();
  if (corpus.includes(normalized)) return true;
  const lastName = normalized.split(/\s+/).at(-1);
  return lastName ? corpus.includes(lastName) : false;
}

/** Head-coach names in prose must be search-verified — shared by Futbolpedia profiles and Gaffa outlooks. */
export function findUnverifiedManagerMentions(
  text: string,
  ctx: ManagerVerificationContext,
): string[] {
  const corpus = verificationCorpus(ctx);
  const verifiedCoach = ctx.currentHeadCoach?.trim() ?? null;
  const issues: string[] = [];

  for (const mentioned of collectManagerMentions(text)) {
    if (verifiedCoach) {
      const verifiedLower = verifiedCoach.toLowerCase();
      const mentionedLower = mentioned.toLowerCase();
      if (mentionedLower === verifiedLower || verifiedLower.includes(mentionedLower)) {
        continue;
      }
      if (isNameVerified(mentioned, corpus)) continue;
      issues.push(
        `manager "${mentioned}" conflicts with verified head coach "${verifiedCoach}"`,
      );
      continue;
    }

    if (!isNameVerified(mentioned, corpus)) {
      issues.push(`manager "${mentioned}" not verified in extraction`);
    }
  }

  return issues;
}
