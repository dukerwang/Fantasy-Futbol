-- Update the function that triggers the Vercel API endpoint
CREATE OR REPLACE FUNCTION trigger_process_auctions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Fire-and-forget POST request to the production URL
  PERFORM net.http_post(
      url:='https://fantasy-futbol-tau.vercel.app/api/cron/process-auctions',
      headers:='{"x-cron-secret": "irenie_beanie"}'::jsonb
  );
END;
$$;
