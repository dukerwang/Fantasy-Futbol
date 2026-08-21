-- Fixes two items flagged by the Supabase security linter (security_definer_view):
--
-- 1. player_rankings: no real exposure risk (players/player_stats are already
--    publicly readable via RLS), but switch to security_invoker anyway to
--    clear the lint and match the recommended default going forward.
-- 2. league_standings: real exposure risk. As SECURITY DEFINER it bypassed
--    RLS entirely, so any client could read every league's teams/standings
--    via PostgREST regardless of membership. Switching to security_invoker
--    makes it respect the querying user's RLS context.
--
-- That fix only works once the underlying `teams` RLS policy actually scopes
-- by league. It was defined with `lm.league_id = lm.league_id` — a tautology
-- comparing a column to itself — instead of `lm.league_id = teams.league_id`,
-- so any member of any one league could read every team in every league.
-- Correct it as part of the same migration.

alter view public.player_rankings set (security_invoker = on);
alter view public.league_standings set (security_invoker = on);

drop policy "Teams: read if league member" on public.teams;
create policy "Teams: read if league member" on public.teams
  for select
  using (exists (
    select 1 from league_members lm
    where lm.league_id = teams.league_id
      and lm.user_id = auth.uid()
  ));
