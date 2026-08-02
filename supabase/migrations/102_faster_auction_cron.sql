-- Migration 102: Tighten the process-auctions sweep from 10 minutes to 1.
--
-- Bids and closes are now realtime-pushed to every viewer (auction_state,
-- migration 078), and a connected viewer's clock triggers near-instant
-- resolution via POST /api/leagues/[leagueId]/auctions/resolve-expired. This
-- job is now purely the backstop for auctions that expire while nobody has
-- the page open. 1 minute is pg_cron's actual floor (jobs "can run anywhere
-- from every second to once a year" per Supabase's own docs — no plan-based
-- minimum), and Vercel's serverless invocation/duration limits (this route
-- already runs at maxDuration = 60 for the Hobby tier) aren't remotely
-- stressed at 1,440 calls/day. There's no cost to going straight to the
-- floor rather than hedging at 2 minutes.
--
-- Idempotent: unschedule-by-name raises XX000 if the job was never
-- scheduled on this database (fresh projects, local dev), so look it up
-- first rather than calling cron.unschedule('name') directly.

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT j.jobid INTO jid
  FROM cron.job j
  WHERE j.jobname = 'process-auctions-10m'
  LIMIT 1;

  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'process-auctions-1m',
  '* * * * *',
  'SELECT trigger_process_auctions();'
);
