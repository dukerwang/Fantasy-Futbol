-- Migration 129: give the live-score-sync webhook enough time to actually finish.
--
-- migration 103 pointed pg_cron's every-2-minute tick at net.http_post() with no
-- timeout_milliseconds, so it ran on pg_net's default: 5000ms. That's fine for the
-- vast majority of idle ticks (the route short-circuits before an actual live
-- window), but during a real live window the full sync — fetch the ~600-player FPL
-- live payload, run each appearance through the rating engine, upsert player_stats,
-- three RPCs, then processMatchupsForGameweek — routinely runs well past 5s. pg_net
-- doesn't just stop listening when that happens: it looks like it drops the
-- in-flight request entirely, so every tick during a live window was failing the
-- same way and player_stats/matchup scores froze at whatever the last tick before
-- the window opened had written (confirmed against GW1: 20+ consecutive
-- "Timeout of 5000 ms reached" rows in net._http_response spanning the entire
-- Arsenal match, and Gabriel/Raya's player_stats stuck at the 45th-minute snapshot
-- for two hours). The route itself already has room to run long
-- (maxDuration = 300 in src/app/api/sync/stats/route.ts) — pg_net was the only
-- thing actually cutting it off.
CREATE OR REPLACE FUNCTION public.trigger_live_score_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
      url:='https://gaffa.live/api/sync/stats?mode=fpl_live',
      headers:=jsonb_build_object('x-cron-secret', public.cron_secret()),
      timeout_milliseconds:=55000
  );
END;
$$;
