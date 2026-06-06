-- ============================================================
-- Migration 050: Lock down SECURITY DEFINER RPCs
-- ============================================================
--
-- The functions below are SECURITY DEFINER, meaning they execute with the
-- table owner's privileges and BYPASS Row Level Security. By PostgreSQL
-- default, CREATE FUNCTION grants EXECUTE to PUBLIC, and in Supabase the
-- `anon` and `authenticated` roles are members of PUBLIC. PostgREST exposes
-- every public-schema function as an RPC endpoint (POST /rest/v1/rpc/<name>),
-- so without an explicit REVOKE these functions are callable directly from the
-- browser client using only the anon key -- bypassing all RLS protections.
--
-- These functions are SERVICE-ROLE ONLY. They must NEVER be callable from the
-- browser/client. They are invoked exclusively by:
--   * server-side API routes using the Supabase admin (service_role) client, or
--   * pg_cron jobs running as the database owner.
--
-- Three of them accept caller-supplied parameters and perform NO
-- ownership/membership validation, making them directly exploitable from the
-- browser before this migration:
--   * increment_team_points  -- arbitrary team points manipulation
--   * resolve_matchup        -- arbitrary matchup score/status manipulation
--   * credit_faab_prize      -- arbitrary FAAB credit + transactions INSERT
--                               (side-doors the transactions RLS write-block)
-- The remaining four take no parameters but are revoked defensively so they
-- cannot be poked from the client.
--
-- We do NOT issue any GRANT statements: service_role retains EXECUTE by default
-- in Supabase and continues to call these functions normally. The service_role
-- client also bypasses these REVOKEs since it is not a member of PUBLIC/anon/
-- authenticated for the purposes of these grants.
--
-- handle_new_user() is intentionally NOT touched -- it is a trigger function
-- (AFTER INSERT ON auth.users) and behaves differently from a callable RPC.
-- ============================================================

-- 1. Exploitable RPCs (caller-supplied params, no ownership checks)
REVOKE EXECUTE ON FUNCTION public.increment_team_points(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_matchup(uuid, numeric, numeric, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_faab_prize(uuid, int, text, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Defensive (no caller-supplied params, but service-role / cron only)
REVOKE EXECUTE ON FUNCTION public.auto_pick_expired_drafts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_player_fantasy_scores() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_start_scheduled_drafts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_process_auctions() FROM PUBLIC, anon, authenticated;
