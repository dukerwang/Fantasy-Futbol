-- Enable pg_net to make outward HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Define a function that triggers the Vercel API endpoint
CREATE OR REPLACE FUNCTION trigger_process_auctions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Fire-and-forget POST request to the Vercel cron endpoint
  PERFORM net.http_post(
      url:='https://fantasy-futbol-dzbvhbvat-dukerwangs-projects.vercel.app/api/cron/process-auctions',
      headers:='{"x-cron-secret": "irenie_beanie"}'::jsonb
  );
END;
$$;

-- Schedule the cron job to run every 10 minutes
SELECT cron.schedule(
  'process-auctions-10m',
  '*/10 * * * *',
  'SELECT trigger_process_auctions();'
);
