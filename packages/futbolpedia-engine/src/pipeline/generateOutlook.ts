import { DEFAULT_SYNTHESIS_JITTER, PIPELINE_VERSION } from '../constants';
import { createGeminiClient } from '../gemini/client';
import { extractTokenUsage } from '../gemini/usage';
import { assertValidOutlook } from '../gates/validateOutlook';
import type { GenerateOutlookOptions, GenerateOutlookResult } from '../types/outlook';
import { extractOutlookFacts } from './extract';
import { buildClubContextQuery, buildOutlookPlayerQueries } from './queryGen';
import { runParallelSearch } from './search';
import { synthesizeOutlook } from './synthesize';
import { resolveSynthesisTemperature } from './synthesisTemperature';

export async function generateOutlook(
  options: GenerateOutlookOptions,
): Promise<GenerateOutlookResult> {
  const { apiKey, contextBag, onUsage } = options;
  const ai = createGeminiClient(apiKey);

  const playerSearch = await runParallelSearch(
    ai,
    buildOutlookPlayerQueries(contextBag),
    contextBag.simulation_date,
  );

  // The head-coach answer is identical for every player at a club, so across a
  // batch it is resolved once. Without the cache this was ~412 redundant
  // grounded requests on a 432-player run.
  let clubFoundation = options.clubCache?.get(contextBag.club);
  let clubRequests = 0;
  if (clubFoundation === undefined) {
    const clubSearch = await runParallelSearch(
      ai,
      [buildClubContextQuery(contextBag)],
      contextBag.simulation_date,
    );
    clubFoundation = clubSearch.foundation;
    clubRequests = clubSearch.groundedRequests;
    options.clubCache?.set(contextBag.club, clubFoundation);
  }

  const foundation = [playerSearch.foundation, clubFoundation].join('\n\n---\n\n');
  const sourceCount = playerSearch.sourceCount;
  const groundedRequests = playerSearch.groundedRequests + clubRequests;

  const extraction = await extractOutlookFacts(ai, contextBag, foundation);

  const tempConfig = options.synthesisTemperature;
  const temperature =
    tempConfig?.mode === 'fixed' && tempConfig.fixed !== undefined
      ? tempConfig.fixed
      : resolveSynthesisTemperature(extraction, {
          // Wired since v0.2 but never given a value, so every well-evidenced
          // player landed on the same temperature. A small per-player band,
          // seeded by id, is stable across regenerations.
          jitter: tempConfig?.jitter ?? DEFAULT_SYNTHESIS_JITTER,
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
    groundedRequests,
  };
}
