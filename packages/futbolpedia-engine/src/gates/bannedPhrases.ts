/** User-facing outlook copy must not contain trade-advice or cringe meta labels. */
export const BANNED_OUTLOOK_PATTERNS: RegExp[] = [
  /\bstrong buy\b/i,
  /\bbuy low\b/i,
  /\bsell high\b/i,
  /\bstrong sell\b/i,
  /\bshould (buy|sell|hold|monitor|fade|target)\b/i,
  /\bworth (buying|selling|holding)\b/i,
  /\b(buy|sell) (him|her|now|in|before)\b/i,
  /\b(hold|sell|monitor|fade) (him|her|for now|before)\b/i,
  /\bin gaffa\b/i,
  /\bin gaffa terms\b/i,
  /\bfor fantasy managers\b/i,
  /\bfrom an fpl perspective\b/i,
  /\bfrom a fantasy perspective\b/i,
  /\bnailed starter who\b/i,
  /\bfrom a dynasty perspective\b/i,
];
