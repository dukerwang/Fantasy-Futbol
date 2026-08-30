import { OUTLOOK_MAX_WORDS, OUTLOOK_MIN_WORDS } from '../constants';
import type { OutlookContextBag, OutlookExtraction, PlayerOutlook } from '../types/outlook';
import { BANNED_OUTLOOK_PATTERNS } from './bannedPhrases';
import { findUnverifiedManagerMentions } from './managerMentions';

export class OutlookValidationError extends Error {
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message);
    this.name = 'OutlookValidationError';
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface OutlookValidationResult {
  ok: boolean;
  reasons: string[];
}

export function validateOutlook(
  outlook: PlayerOutlook,
  extraction: OutlookExtraction,
  _bag: OutlookContextBag,
): OutlookValidationResult {
  const reasons: string[] = [];
  const words = wordCount(outlook.outlook);

  if (words < OUTLOOK_MIN_WORDS) {
    reasons.push(`outlook too short (${words} words, min ${OUTLOOK_MIN_WORDS})`);
  }
  if (words > OUTLOOK_MAX_WORDS) {
    reasons.push(`outlook too long (${words} words, max ${OUTLOOK_MAX_WORDS})`);
  }

  for (const pattern of BANNED_OUTLOOK_PATTERNS) {
    if (pattern.test(outlook.outlook)) {
      reasons.push(`banned phrase matched: ${pattern.source}`);
    }
  }

  if (
    outlook.sidecar.confidence === 'high' &&
    (extraction.data_gaps.length > 2 || outlook.sidecar.evidence_gaps.length > 2)
  ) {
    reasons.push('confidence high with too many evidence gaps');
  }

  if (!outlook.outlook.trim()) {
    reasons.push('outlook is empty');
  }

  const SCORING_INFLATION = [
    /\btop[- ]scor/i,
    /\bleague[- ]leading points/i,
    /\bfantasy points/i,
    /\bform rating\b/i,
    /\bmatch rating\b/i,
    /\bpoints per game\b/i,
  ];
  for (const pattern of SCORING_INFLATION) {
    if (pattern.test(outlook.outlook)) {
      reasons.push(`scoring inflation phrase matched: ${pattern.source}`);
    }
  }

  for (const issue of findUnverifiedManagerMentions(outlook.outlook, {
    verifiedFacts: extraction.verified_facts,
    supplementalCorpus: [
      extraction.status_summary,
      extraction.role_summary,
      extraction.mobility_summary,
    ],
    currentHeadCoach: extraction.current_head_coach,
  })) {
    reasons.push(`unverified manager mention: ${issue}`);
  }

  return { ok: reasons.length === 0, reasons };
}

export function assertValidOutlook(
  outlook: PlayerOutlook,
  extraction: OutlookExtraction,
  bag: OutlookContextBag,
): void {
  const result = validateOutlook(outlook, extraction, bag);
  if (!result.ok) {
    throw new OutlookValidationError(
      `Outlook failed validation: ${result.reasons.join('; ')}`,
      result.reasons,
    );
  }
}
