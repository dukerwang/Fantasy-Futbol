import { PIPELINE_VERSION } from './constants';
import { assertValidOutlook, OutlookValidationError, validateOutlook } from './gates/validateOutlook';
import { findUnverifiedManagerMentions } from './gates/managerMentions';
import { compareSynthesisTemperatures } from './pipeline/compareTemperatures';
import { generateOutlook } from './pipeline/generateOutlook';
import { resolveSynthesisTemperature } from './pipeline/synthesisTemperature';
import { buildOutlookSearchQueries } from './pipeline/queryGen';
import type { GenerateOutlookOptions, GenerateOutlookResult } from './types/outlook';

export { PIPELINE_VERSION, FLASH_MODEL, OUTLOOK_MIN_WORDS, OUTLOOK_MAX_WORDS } from './constants';

export {
  FACET_THRESHOLDS,
  buildComputedFactsBlock,
  computeCareerPhase,
  computeDynastyValue,
  computeFallbackFacets,
  computeMinutesRole,
  computeRiskFlags,
  computeSetPieces,
  resolveAvailabilityShare,
  resolveRoleShare,
} from './facets/compute';

export { OUTLOOK_STYLES } from './facets/types';

export type {
  DynastyValue,
  FacetInputs,
  FallbackFacets,
  JudgedFacets,
  MinutesRole,
  MinutesSample,
  OutlookStyle,
  PlMobility,
  QualityTier,
  RiskFlag,
  SetPieceDuty,
} from './facets/types';

export type {
  CompareSynthesisTemperaturesOptions,
  GenerateOutlookOptions,
  GenerateOutlookResult,
  SynthesisTemperatureConfig,
  TemperatureComparisonRow,
  GranularPosition,
  OutlookAvailability,
  OutlookCareerPhase,
  OutlookConfidence,
  OutlookContextBag,
  OutlookExtraction,
  OutlookHorizon,
  PlayerOutlook,
  PlayerOutlookSidecar,
  TokenUsage,
} from './types/outlook';

export {
  buildLockedFactsBlock,
  buildOutlookExtractionPrompt,
  buildOutlookQueryGenPrompt,
  buildOutlookSynthesisPrompt,
  buildOutlookSystemInstruction,
} from './prompts/outlook';

export {
  compareSynthesisTemperatures,
  generateOutlook,
  buildOutlookSearchQueries,
  resolveSynthesisTemperature,
  validateOutlook,
  assertValidOutlook,
  OutlookValidationError,
  findUnverifiedManagerMentions,
};
export type { ManagerVerificationContext } from './gates/managerMentions';
