import { OUTLOOK_MAX_WORDS, OUTLOOK_MIN_WORDS } from '../constants';
import type { OutlookContextBag, OutlookExtraction, PlayerOutlook } from '../types/outlook';
import { OUTLOOK_STYLES } from '../facets/types';
import { BANNED_OUTLOOK_PATTERNS } from './bannedPhrases';
import { findOpeningIssues } from './openingPatterns';
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
  bag: OutlookContextBag,
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

  for (const issue of findOpeningIssues(outlook.outlook, bag?.club)) {
    reasons.push(`formulaic opening matched: ${issue}`);
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

  // The schema constrains these, but a retry path or a hand-built sidecar can
  // still carry a value the filters and card chips cannot render. Closed means
  // closed — the whole point of replacing the free-text tags.
  const ENUMS: Record<string, readonly string[]> = {
    quality: ['elite', 'high', 'solid', 'squad'],
    minutes_role: ['nailed', 'likely_starter', 'rotation_risk', 'fringe'],
    career_phase: ['emerging', 'peak', 'plateau', 'decline_risk', 'unknown'],
    dynasty_value: ['cornerstone', 'long_term_hold', 'win_now', 'declining_asset'],
    pl_mobility: [
      'stable',
      'recent_pl_arrival',
      'linked_exit',
      'confirmed_exit',
      'linked_pl_move',
      'unknown',
    ],
  };
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const value = (outlook.sidecar as unknown as Record<string, unknown>)[field];
    if (typeof value !== 'string' || !allowed.includes(value)) {
      reasons.push(`sidecar.${field} outside its enum: ${String(value)}`);
    }
  }
  for (const flag of outlook.sidecar.risk_flags ?? []) {
    if (!['injury_prone', 'minutes_competition', 'contract_year', 'tactical_misfit'].includes(flag)) {
      reasons.push(`sidecar.risk_flags contains an unknown value: ${flag}`);
    }
  }
  for (const style of outlook.sidecar.style ?? []) {
    if (!(OUTLOOK_STYLES as readonly string[]).includes(style)) {
      reasons.push(`sidecar.style contains an unknown value: ${style}`);
    }
  }
  if ((outlook.sidecar.style ?? []).length > 3) {
    reasons.push('sidecar.style carries more than three archetypes');
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
