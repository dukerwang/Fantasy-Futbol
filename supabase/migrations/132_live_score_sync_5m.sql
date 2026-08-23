-- Migration 132: slow live-score-sync-2m down to every 5 minutes.
--
-- Migration 131 stopped the two RPCs this job calls from rewriting the whole
-- `players` table every tick, but the site still went down during live play
-- on two more matchdays after that fix (2026-08-22 and 2026-08-23). Caught
-- it live on the second one: pg_stat_activity showed even a trivial,
-- in-memory `SELECT name FROM pg_timezone_names` — no user table, no disk
-- touch at steady state — stuck "active" for 2+ minutes with no lock/wait.
-- That means the instance itself was CPU/IO-starved, not just our sync
-- queries running long. The 2-minute cadence (each tick itself can run up to
-- 55s during a real live window per migration 129) leaves too little idle
-- time between ticks for the disk's burst credit to recover during a live
-- gameweek. Dropping to every 5 minutes cuts tick frequency by 60% as a free
-- mitigation; revisit a compute/disk tier upgrade if this isn't enough.

SELECT cron.unschedule('live-score-sync-2m');

SELECT cron.schedule(
  'live-score-sync-5m',
  '*/5 * * * *',
  'SELECT trigger_live_score_sync();'
);
