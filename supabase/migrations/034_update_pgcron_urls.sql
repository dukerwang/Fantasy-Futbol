-- Unschedule the old background auction job
SELECT cron.unschedule('process-auctions');

-- Re-schedule with the correct production URL
SELECT cron.schedule(
    'process-auctions',
    '*/10 * * * *', -- Run every 10 minutes
    $$
    SELECT net.http_post(
        url := 'https://fantasy-futbol-tau.vercel.app/api/cron/process-auctions',
        headers := '{"Content-Type": "application/json", "x-cron-secret": "irenie_beanie"}'::jsonb
    )
    $$
);
