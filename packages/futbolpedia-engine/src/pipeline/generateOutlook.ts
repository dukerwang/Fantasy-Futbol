import { PIPELINE_VERSION } from '../constants';
import { createGeminiClient } from '../gemini/client';
import { extractTokenUsage } from '../gemini/usage';
import { assertValidOutlook } from '../gates/validateOutlook';
import type { GenerateOutlookOptions, GenerateOutlookResult } from '../types/outlook';
import { extractOutlookFacts } from './extract';
import { buildOutlookSearchQueries } from './queryGen';
import { runParallelSearch } from './search';
import { synthesizeOutlook } from './synthesize';
import { resolveSynthesisTemperature } from './synthesisTemperature';

export async function generateOutlook(
  options: GenerateOutlookOptions,
): Promise<GenerateOutlookResult> {
  const { apiKey, contextBag, onUsage } = options;
  const ai = createGeminiClient(apiKey);

  const queries = buildOutlookSearchQueries(contextBag);
  const { foundation, sourceCount } = await runParallelSearch(
    ai,
    queries,
    contextBag.simulation_date,
  );

  const extraction = await extractOutlookFacts(ai, contextBag, foundation);

  const tempConfig = options.synthesisTemperature;
  const temperature =
    tempConfig?.mode === 'fixed' && tempConfig.fixed !== undefined
      ? tempConfig.fixed
      : resolveSynthesisTemperature(extraction, {
          jitter: tempConfig?.jitter,
          jitterSeed: contextBag.player_id,
        });

  const draft = await synthesizeOutlook(
    ai,
    contextBag,
    foundation,
    extraction,
    temperature,
    options.facts,
  );

  draft.sidecar.generated_at = new Date().toISOString();
  draft.sidecar.pipeline_version = PIPELINE_VERSION;

  assertValidOutlook(draft, extraction, contextBag);

  if (onUsage) {
    // Usage is logged per-stage; callers can aggregate from logs for now.
    onUsage(extractTokenUsage({}));
  }

  return {
    ...draft,
    extraction,
    groundingSourceCount: sourceCount,
  };
}
