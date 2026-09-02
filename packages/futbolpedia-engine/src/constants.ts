/** Bump when prompt/schema or pipeline behavior changes materially. */
export const PIPELINE_VERSION = '0.3.4';

export const FLASH_MODEL = 'gemini-3.7-flash';

/** Align with Futbolpedia master instruction temporal anchor. */
export const SIMULATION_YEAR = 2026;
export const SIMULATION_SEASON = '2026-27';
export const SIMULATION_DATE = `${SIMULATION_YEAR}-08-26`;

/**
 * Per-player temperature band, seeded by player id. Small on purpose: this is a
 * secondary lever, since temperature varies with evidence richness rather than
 * voice, and the opening law does the real work.
 */
export const DEFAULT_SYNTHESIS_JITTER = 0.06;

/** Outlook copy targets — enforced again in validateOutlook (Task 3). */
export const OUTLOOK_MIN_WORDS = 50;
export const OUTLOOK_MAX_WORDS = 130;
