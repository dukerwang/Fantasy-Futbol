-- "Enable read access for all league members" on pending_drops (055) never
-- actually checked the requesting user — it let any authenticated user, in
-- any league, read every team's pending drops. src/lib/teams/loadClubView.ts
-- treats a pending drop as private to the owning manager ("a pending drop is
-- an intention... surfacing it on a rival's page would leak the manager's
-- hand") and only ever queries this table via the service-role client, so
-- nothing in the app relies on this policy.
--
-- "Enable write access for team owner" is FOR ALL, which already covers
-- SELECT for the owning team's user — dropping the broken policy leaves
-- exactly the intended owner-only access with no functional loss.

drop policy if exists "Enable read access for all league members" on public.pending_drops;
