-- Migration 037: Remove the sync-ratings pg_cron job.
--
-- The weekly Tuesday 08:00 pg_cron that POSTed to the supabase/functions/sync-ratings
-- Edge Function is redundant with the Vercel cron at /api/sync/stats?mode=fpl_live
-- (which fires daily at 18:00 and 23:00 UTC). The Edge Function was a divergent
-- copy of src/lib/scoring/matchRating.ts — keeping it meant two engines could
-- write conflicting fantasy_points / match_rating values for the same fixture
-- depending on which path ran last.
--
-- After this migration:
--   - Next.js path (src/app/api/sync/stats/route.ts) is the single source of truth
--   - The deployed Edge Function on Supabase becomes a no-op (no callers)
--     and can be torn down with `supabase functions delete sync-ratings`
--
-- Idempotent: `SELECT cron.unschedule('jobname')` raises XX000 if that name
-- was never scheduled on this database (fresh projects, renamed jobs, etc.).

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT j.jobid INTO jid
  FROM cron.job j
  WHERE j.jobname = 'sync-ratings-weekly'
  LIMIT 1;

  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;
