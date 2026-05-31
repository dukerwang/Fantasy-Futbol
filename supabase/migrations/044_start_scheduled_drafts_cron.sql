-- Migration 044: Add pg_cron job for starting scheduled drafts automatically
-- This function triggers the Vercel API endpoint for scheduled drafts
CREATE OR REPLACE FUNCTION public.trigger_start_scheduled_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Fire-and-forget POST request to the Vercel cron endpoint
  PERFORM net.http_post(
      url:='https://gaffa.live/api/cron/start-scheduled-drafts',
      headers:='{"x-cron-secret": "irenie_beanie"}'::jsonb
  );
END;
$$;

-- Schedule the cron job to run every minute
SELECT cron.schedule(
  'start-scheduled-drafts-1m',
  '* * * * *',
  'SELECT public.trigger_start_scheduled_drafts();'
);
