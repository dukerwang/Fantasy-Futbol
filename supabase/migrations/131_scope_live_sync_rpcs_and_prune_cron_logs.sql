-- Fixes the two things burning the disk I/O budget during any live gameweek:
--
-- 1. update_player_fantasy_scores(p_season) and update_player_form_ratings(p_season)
--    ran a blanket UPDATE across the entire `players` table on every single
--    2-minute pg_cron tick of a live gameweek (live-score-sync-2m), including
--    a full-table zero-reset in update_player_form_ratings before recomputing.
--    That's a full rewrite of every player row every 2 minutes for the whole
--    live window, most of which touch rows whose value didn't actually change.
--    Rewritten to compute the new value via a join and only write rows where
--    the value is actually different (`IS DISTINCT FROM` guard) — Postgres
--    still evaluates every row, but skips the write (and the dead tuple/WAL
--    cost) for the ones that are already correct. End state is identical to
--    the previous implementation (including the same 0-default for players
--    with no qualifying stats yet), just without the wasted rewrites.
--
-- 2. cron.job_run_details had no retention policy — every run of every
--    pg_cron job (several firing every 20s-2min, 24/7) has been logged since
--    Feb 2026 and never pruned: 926k+ rows, 170MB, pure growth. Prune what's
--    there now and schedule a daily job to keep only the last 3 days, which
--    is all `list_triggers`/debugging ever needs.
--
-- The two no-arg legacy overloads (update_player_fantasy_scores(),
-- update_player_form_ratings()) are dropped — nothing in the app calls them
-- (only the p_season-arg versions, from src/app/api/sync/stats/route.ts),
-- and they hardcode season '2025-26', which is no longer even the current
-- season.

drop function if exists public.update_player_fantasy_scores();
drop function if exists public.update_player_form_ratings();

create or replace function public.update_player_fantasy_scores(p_season text default '2025-26'::text)
returns void
language plpgsql
security definer
as $function$
begin
  with totals as (
    select player_id, sum(fantasy_points) as total_points
    from player_stats
    where season = p_season
    group by player_id
  ),
  form_gw as (
    select player_id, gameweek, sum(fantasy_points) as gw_pts
    from player_stats
    where season = p_season
      and (stats->>'minutes_played')::int >= 15
    group by player_id, gameweek
  ),
  form_ranked as (
    select player_id, gw_pts,
      row_number() over (partition by player_id order by gameweek desc) as rn
    from form_gw
  ),
  form_agg as (
    select player_id, avg(gw_pts) as form
    from form_ranked
    where rn <= 5
    group by player_id
  )
  update players p
  set total_points = coalesce(totals.total_points, 0),
      form = coalesce(form_agg.form, 0)
  from (select id from players) all_players
  left join totals on totals.player_id = all_players.id
  left join form_agg on form_agg.player_id = all_players.id
  where p.id = all_players.id
    and (p.total_points is distinct from coalesce(totals.total_points, 0)
         or p.form is distinct from coalesce(form_agg.form, 0));
end;
$function$;

create or replace function public.update_player_form_ratings(p_season text default '2025-26'::text)
returns void
language plpgsql
as $function$
begin
  with rating_ranked as (
    select
      player_id,
      match_rating,
      row_number() over (partition by player_id order by gameweek desc) as rn
    from player_stats
    where season = p_season
      and match_rating is not null
      and (stats->>'minutes_played')::int >= 15
  ),
  rating_agg as (
    select player_id, round(avg(match_rating)::numeric, 1) as avg_rating
    from rating_ranked
    where rn <= 5
    group by player_id
  ),
  pts_agg as (
    select player_id, round(avg(fantasy_points)::numeric, 1) as avg_pts
    from player_stats
    where season = p_season
      and fantasy_points is not null
      and (stats->>'minutes_played')::int >= 15
    group by player_id
  )
  update public.players p
  set form_rating = coalesce(rating_agg.avg_rating, 0),
      ppg = coalesce(pts_agg.avg_pts, 0)
  from (select id from public.players where is_active = true) active_players
  left join rating_agg on rating_agg.player_id = active_players.id
  left join pts_agg on pts_agg.player_id = active_players.id
  where p.id = active_players.id
    and (p.form_rating is distinct from coalesce(rating_agg.avg_rating, 0)
         or p.ppg is distinct from coalesce(pts_agg.avg_pts, 0));
end;
$function$;

-- Prune what's already there (926k+ rows going back to Feb 2026) and keep a
-- daily job pruning anything older than 3 days from now on.
delete from cron.job_run_details where start_time < now() - interval '3 days';

select cron.schedule(
  'prune-cron-job-run-details-daily',
  '0 3 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '3 days'$$
);
