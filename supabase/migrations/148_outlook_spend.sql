-- Monthly ledger of billable Google-Search-grounded requests.
--
-- The batch runner's previous cap did `tokensUsed += 4` per player and compared
-- it to a "token budget" — it counted calls as if they were tokens and knew
-- nothing about grounding, which is the unit that actually costs money. With a
-- $10/month ceiling that is the difference between a cap and a decoration.
--
-- Kept per calendar month and incremented atomically, so a cap survives across
-- runs, processes and a crashed batch rather than resetting each invocation.
CREATE TABLE IF NOT EXISTS public.outlook_spend (
  month             TEXT PRIMARY KEY,   -- 'YYYY-MM', UTC
  grounded_requests INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.outlook_spend ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: reachable only through the service role.

/**
 * Add to this month's tally and return the new total, in one statement so
 * concurrent batch workers cannot both read the same figure and overwrite each
 * other's increment.
 */
CREATE OR REPLACE FUNCTION public.increment_outlook_spend(p_month TEXT, p_requests INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total INTEGER;
BEGIN
  INSERT INTO public.outlook_spend AS s (month, grounded_requests)
  VALUES (p_month, p_requests)
  ON CONFLICT (month) DO UPDATE
    SET grounded_requests = s.grounded_requests + EXCLUDED.grounded_requests,
        updated_at = NOW()
  RETURNING s.grounded_requests INTO total;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_outlook_spend(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
