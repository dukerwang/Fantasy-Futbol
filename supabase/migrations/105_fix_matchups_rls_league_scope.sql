-- Migration 105: Fix the "Matchups: read if league member" RLS policy —
-- it isn't actually scoped to the league.
--
-- 001_initial_schema.sql:403-409 wrote:
--
--     EXISTS (SELECT 1 FROM public.league_members lm
--             WHERE lm.league_id = league_id AND lm.user_id = auth.uid())
--
-- The unqualified `league_id` on the left of the first comparison resolves to
-- the closest matching column in scope — `lm.league_id`, from the subquery's
-- own FROM clause — not the outer `matchups.league_id` the author meant.
-- Postgres accepted it silently because both tables have a `league_id`
-- column, so this compiled to `lm.league_id = lm.league_id`: always true.
-- The policy has actually been "read if you're in ANY league", not "read if
-- you're in THIS matchup's league", since the app's first migration.
--
-- This went unnoticed because every application read of `matchups` goes
-- through the admin client (service role, bypasses RLS) with its own
-- explicit membership check performed first. The first RLS-scoped reads are
-- the new Realtime subscriptions added this week (LiveMatchupCard.tsx,
-- MatchupLiveRefresh.tsx) — postgres_changes enforces this policy per
-- Supabase's own design, so an authenticated member of ANY league could open
-- a channel filtered to an arbitrary matchup id from a league they aren't in
-- and receive its UPDATE payloads (full row — lineups and status, not just
-- the score). No legitimate caller relies on the wider behavior: both
-- realtime subscriptions only ever request an id the server already
-- authorized. This tightens the policy to what its name always claimed.

DROP POLICY IF EXISTS "Matchups: read if league member" ON public.matchups;
CREATE POLICY "Matchups: read if league member"
  ON public.matchups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = matchups.league_id AND lm.user_id = auth.uid()
    )
  );

-- Post-apply check (should return zero rows — every league_members row
-- claims membership in a league that has a real leagues row; this just
-- confirms the alias resolves how the fix intends):
--   SELECT 1 FROM public.league_members lm
--   JOIN public.matchups m ON m.league_id <> lm.league_id
--   LIMIT 1;
