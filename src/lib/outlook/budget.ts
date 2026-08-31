import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Monthly ceiling on billable Google-Search-grounded requests.
 *
 * Grounding is billed per request and dominates the cost of a run — tokens are
 * a rounding error beside it. One outlook issues two player queries plus, for
 * the first player at a club in a batch, one club query.
 *
 * The cap is deliberately a hard stop rather than a warning: the budget is
 * $10/month, and a runaway batch would spend it in a single invocation.
 */
export const DEFAULT_MONTHLY_GROUNDED_CAP = 250;

export function monthlyCap(): number {
  const raw = process.env.OUTLOOK_MONTHLY_GROUNDED_CAP;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_GROUNDED_CAP;
}

/** Current UTC calendar month, the ledger key. */
export function currentSpendMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getMonthlySpend(
  admin: SupabaseClient,
  month = currentSpendMonth(),
): Promise<number> {
  const { data, error } = await admin
    .from('outlook_spend')
    .select('grounded_requests')
    .eq('month', month)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.grounded_requests ?? 0;
}

/** Add to this month's tally atomically and return the new total. */
export async function recordSpend(
  admin: SupabaseClient,
  requests: number,
  month = currentSpendMonth(),
): Promise<number> {
  if (requests <= 0) return getMonthlySpend(admin, month);
  const { data, error } = await admin.rpc('increment_outlook_spend', {
    p_month: month,
    p_requests: requests,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export interface BudgetCheck {
  allowed: boolean;
  spent: number;
  cap: number;
  remaining: number;
}

/**
 * Whether another outlook can be afforded. `estimatedRequests` should be what
 * one outlook costs — two, or three when its club is not yet cached.
 */
export async function checkBudget(
  admin: SupabaseClient,
  estimatedRequests: number,
  month = currentSpendMonth(),
): Promise<BudgetCheck> {
  const cap = monthlyCap();
  const spent = await getMonthlySpend(admin, month);
  return {
    allowed: spent + estimatedRequests <= cap,
    spent,
    cap,
    remaining: Math.max(cap - spent, 0),
  };
}
