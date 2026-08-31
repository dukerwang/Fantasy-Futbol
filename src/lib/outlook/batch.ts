import type { SupabaseClient } from '@supabase/supabase-js';
import { OutlookValidationError } from '@futbolpedia/engine';
import { generateAndStorePlayerOutlook } from '@/lib/outlook/generate';
import {
  checkBudget,
  getMonthlySpend,
  monthlyCap,
  recordSpend,
} from '@/lib/outlook/budget';
import { loadFacetInputs } from '@/lib/outlook/facetInputs';
import { loadRegularPlayerIds } from '@/lib/outlook/population';

export interface BatchOutlookReport {
  attempted: number;
  generated: number;
  skipped: number;
  failed: number;
  failures: Array<{ playerId: string; error: string }>;
  generatedIds: string[];
  skippedIds: string[];
  /** Billable grounded requests this run issued, and the month's position. */
  groundedRequests: number;
  monthlySpend: number;
  monthlyCap: number;
  stoppedOnBudget: boolean;
}

export interface RunOutlookBatchOptions {
  playerIds?: string[];
  regulars?: boolean;
  limit?: number;
  force?: boolean;
  /** Cap for this run alone, on top of the persistent monthly ceiling. */
  groundedRequestBudget?: number;
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
    groundedRequests: 0,
    monthlySpend: await getMonthlySpend(admin),
    monthlyCap: monthlyCap(),
    stoppedOnBudget: false,
  };

  // One pass over the season's stats for the whole batch. Per player this was
  // re-reading every player_stats row in the season, once each.
  const { inputs: factsById } = await loadFacetInputs(admin, { playerIds });

  // Shared across the run so the club-context query costs one grounded request
  // per club instead of one per player.
  const clubCache = new Map<string, string>();

  for (const playerId of playerIds) {
    // Three when this player's club has not been searched yet, two after.
    const estimate = 3;

    if (
      options.groundedRequestBudget != null &&
      report.groundedRequests + estimate > options.groundedRequestBudget
    ) {
      report.stoppedOnBudget = true;
      break;
    }

    const budget = await checkBudget(admin, estimate);
    if (!budget.allowed) {
      report.stoppedOnBudget = true;
      report.monthlySpend = budget.spent;
      report.failures.push({
        playerId,
        error: `monthly grounded-request cap reached (${budget.spent}/${budget.cap}) — batch stopped`,
      });
      break;
    }

    try {
      const result = await generateAndStorePlayerOutlook(admin, playerId, {
        force: options.force,
        facts: factsById.get(playerId),
        clubCache,
      });
      if (result.skipped) {
        report.skipped += 1;
        report.skippedIds.push(playerId);
      } else {
        report.generated += 1;
        report.generatedIds.push(playerId);
        // Charge what was actually issued, reported by the engine, rather than
        // a guess — the club query is free after the first player at that club.
        const issued = result.groundedRequests ?? estimate;
        report.groundedRequests += issued;
        report.monthlySpend = await recordSpend(admin, issued);
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
