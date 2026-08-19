-- Gaffa — Migration 124: restore the missing auto-pick cron offsets
--
-- 011_auto_pick_cron.sql scheduled three jobs (auto-pick-draft-00/-20/-40)
-- to approximate a 20s sweep, since pg_cron's native minimum is 1 minute.
-- No migration ever unscheduled -20 or -40, but `cron.job` on the live
-- database only has -00. They were likely lost the same way 011 itself
-- documents happening to other objects in this project's history — applied
-- once outside a tracked migration flow and never reapplied after a manual
-- edit or restore.
--
-- Effect while missing: every league's autopick sweep ran at 60s
-- granularity instead of ~20s, adding up to an extra ~60s (avg ~30s) on top
-- of the 120s pick timer before an absent manager's pick fired. Confirmed
-- against the "Matchday Militia" draft's actual pick timestamps — the
-- slowest gaps (154s-176s) line up with 120s + up to ~56s of missing sweep
-- granularity, not an actual autopick failure.
--
-- cron.schedule() upserts by job name, so this is safe to run even if one
-- of the two happens to already exist.

SELECT cron.schedule(
  'auto-pick-draft-20',
  '* * * * *',
  'SELECT pg_sleep(20); SELECT auto_pick_expired_drafts()'
);

SELECT cron.schedule(
  'auto-pick-draft-40',
  '* * * * *',
  'SELECT pg_sleep(40); SELECT auto_pick_expired_drafts()'
);
