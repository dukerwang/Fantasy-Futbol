import { createGeminiClient } from '../gemini/client';
import { validateOutlook } from '../gates/validateOutlook';
import type {
  CompareSynthesisTemperaturesOptions,
  OutlookContextBag,
  OutlookExtraction,
  TemperatureComparisonRow,
} from '../types/outlook';
import { extractOutlookFacts } from './extract';
import { buildOutlookSearchQueries } from './queryGen';
import { runParallelSearch } from './search';
import { synthesizeOutlook } from './synthesize';
import { resolveSynthesisTemperature } from './synthesisTemperature';

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function loadFoundation(
  apiKey: string,
  bag: OutlookContextBag,
): Promise<{ foundation: string; extraction: OutlookExtraction; sourceCount: number; ai: ReturnType<typeof createGeminiClient> }> {
  const ai = createGeminiClient(apiKey);
  const queries = buildOutlookSearchQueries(bag);
  const { foundation, sourceCount } = await runParallelSearch(ai, queries, bag.simulation_date);
  const extraction = await extractOutlookFacts(ai, bag, foundation);
  return { foundation, extraction, sourceCount, ai };
}

/** One search+extract pass, multiple synthesis temps — cheap A/B for voice tuning. */
export async function compareSynthesisTemperatures(
  options: CompareSynthesisTemperaturesOptions,
): Promise<{
  extraction: OutlookExtraction;
  groundingSourceCount: number;
  rows: TemperatureComparisonRow[];
}> {
  const {
    apiKey,
    contextBag,
    temperatures = [0.6, 0.7, 0.85, 0.95],
    includeAuto = true,
    autoJitter = 0,
  } = options;

  const { foundation, extraction, sourceCount, ai } = await loadFoundation(apiKey, contextBag);

  const runs: Array<{ label: string; temperature: number }> = temperatures.map((t) => ({
    label: `fixed ${t}`,
    temperature: t,
  }));

  if (includeAuto) {
    runs.push({
      label: autoJitter > 0 ? `auto+jitter ${autoJitter}` : 'auto',
      temperature: resolveSynthesisTemperature(extraction, {
        jitter: autoJitter,
        jitterSeed: contextBag.player_id,
      }),
    });
  }

  const rows: TemperatureComparisonRow[] = [];

  for (const run of runs) {
    const draft = await synthesizeOutlook(ai, contextBag, foundation, extraction, run.temperature);
    const validation = validateOutlook(draft, extraction, contextBag);
    rows.push({
      label: run.label,
      temperature: run.temperature,
      outlook: draft.outlook,
      sidecar: draft.sidecar,
      wordCount: wordCount(draft.outlook),
      validation: validation.ok
        ? { ok: true }
        : { ok: false, errors: validation.reasons },
    });
  }

  return { extraction, groundingSourceCount: sourceCount, rows };
}
