-- Update the function that triggers the Vercel API endpoint
CREATE OR REPLACE FUNCTION trigger_process_auctions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Fire-and-forget POST request to the production URL
  PERFORM net.http_post(
      url:='https://gaffa.live/api/cron/process-auctions',
      -- Secret redacted. This literal leaked via the public repo; migration 098
      -- moves it to Supabase Vault and 098's runbook rotates it. Superseded —
      -- do not reintroduce a literal here.
      headers:=jsonb_build_object('x-cron-secret', public.cron_secret())
  );
END;
$$;
