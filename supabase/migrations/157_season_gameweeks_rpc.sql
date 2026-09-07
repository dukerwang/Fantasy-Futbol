-- Distinct gameweeks that actually have stats rows for a season.
--
-- The players index needs this list to build its gameweek picker. It used to
-- read it by selecting `gameweek` for the whole season and de-duplicating in
-- JS -- 14,521 rows for 2025-26, of which PostgREST returns the first 1,000.
-- Ordered ascending, those 1,000 rows cover only gameweeks 1-3, so the picker
-- silently offered three weeks of a thirty-eight week season.
--
-- One row per gameweek instead, ordered, done in the database.
create or replace function public.season_gameweeks(p_season text)
returns table (gameweek integer)
language sql
stable
security definer
set search_path = public
as $$
  select distinct ps.gameweek
  from public.player_stats ps
  where ps.season = p_season
    and ps.gameweek is not null
  order by 1 asc;
$$;

grant execute on function public.season_gameweeks(text) to authenticated, service_role;
