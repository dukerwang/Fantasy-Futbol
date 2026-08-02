-- Migration 103: Sync live FPL scores every 2 minutes instead of twice a day.
--
-- /api/sync/stats?mode=fpl_live has always run on Vercel's native cron
-- (vercel.json), which is why it's split into two fixed-time entries (18:00
-- and 23:00 UTC) rather than one "twice daily" schedule — Vercel Hobby caps
-- native Cron Jobs at once per day per job; a more frequent expression fails
-- deployment outright. process-auctions hit the exact same ceiling and was
-- moved onto Supabase pg_cron + net.http_post instead (019_auction_pgcron.sql)
-- — a plain webhook POST, which Vercel does not rate-limit. This does the
-- same for live scoring.
--
-- Cheap when idle: the route (src/app/api/sync/stats/route.ts) now short-
-- circuits before touching the ~600-player live payload unless the current
-- gameweek's deadline has passed and FPL hasn't marked it finished, so most
-- of these ticks cost one bootstrap-static request, not a full sync.
--
-- The two vercel.json entries are left in place as a backstop for one
-- gameweek before being removed in a follow-up, once this is confirmed
-- running reliably.

CREATE OR REPLACE FUNCTION public.trigger_live_score_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
      url:='https://gaffa.live/api/sync/stats?mode=fpl_live',
      headers:=jsonb_build_object('x-cron-secret', public.cron_secret())
  );
END;
$$;

SELECT cron.schedule(
  'live-score-sync-2m',
  '*/2 * * * *',
  'SELECT trigger_live_score_sync();'
);
