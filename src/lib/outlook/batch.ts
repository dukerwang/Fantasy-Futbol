import type { SupabaseClient } from '@supabase/supabase-js';
import { OutlookValidationError } from '@futbolpedia/engine';
import { generateAndStorePlayerOutlook } from '@/lib/outlook/generate';
import { loadRegularPlayerIds } from '@/lib/outlook/population';

export interface BatchOutlookReport {
  attempted: number;
  generated: number;
  skipped: number;
  failed: number;
  failures: Array<{ playerId: string; error: string }>;
  generatedIds: string[];
  skippedIds: string[];
}

export interface RunOutlookBatchOptions {
  playerIds?: string[];
  regulars?: boolean;
  limit?: number;
  force?: boolean;
  tokenBudget?: number;
}

export async function runOutlookBatch(
  admin: SupabaseClient,
  options: RunOutlookBatchOptions = {},
): Promise<BatchOutlookReport> {
  let playerIds = options.playerIds ?? [];
  if (options.regulars) {
    playerIds = await loadRegularPlayerIds(admin, options.limit);
  } else if (options.limit && !options.playerIds?.length) {
    playerIds = (await loadRegularPlayerIds(admin)).slice(0, options.limit);
  }

  const report: BatchOutlookReport = {
    attempted: playerIds.length,
    generated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    generatedIds: [],
    skippedIds: [],
  };

  let tokensUsed = 0;

  for (const playerId of playerIds) {
    if (options.tokenBudget && tokensUsed >= options.tokenBudget) {
      report.failures.push({
        playerId,
        error: 'token budget cap reached — batch paused',
      });
      report.failed += 1;
      break;
    }

    try {
      const result = await generateAndStorePlayerOutlook(admin, playerId, {
        force: options.force,
      });
      if (result.skipped) {
        report.skipped += 1;
        report.skippedIds.push(playerId);
      } else {
        report.generated += 1;
        report.generatedIds.push(playerId);
        tokensUsed += 4; // rough estimate: ~4 Flash calls per outlook
      }
    } catch (error: unknown) {
      report.failed += 1;
      const message =
        error instanceof OutlookValidationError
          ? `${error.message} [${error.reasons.join(', ')}]`
          : error instanceof Error
            ? error.message
            : String(error);
      report.failures.push({ playerId, error: message });
    }
  }

  return report;
}
